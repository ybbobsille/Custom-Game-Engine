import wrtc from "@roamhq/wrtc";
import readline from "node:readline";
import { WebSocket } from "ws";
import fs from "node:fs";
import Ui_Setup from "./Ui_Setup.js";

var Base64 = {
    ALPHA: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
    encode: function (value) {

        if (typeof (value) !== 'number') {
            throw 'Value is not number!';
        }

        var result = '', mod;
        do {
            mod = value % 64;
            result = Base64.ALPHA.charAt(mod) + result;
            value = Math.floor(value / 64);
        } while (value > 0);

        return result;
    },
    decode: function (value) {

        var result = 0;
        for (var i = 0, len = value.length; i < len; i++) {
            result *= 64;
            result += Base64.ALPHA.indexOf(value[i]);
        }

        return result;
    },
};
var room_id = null
const users = []
const users_connections = {}
const file_buffer = {}
const real_time = {}

function Buffer_File(fp) {
    if (file_buffer[fp]) {
        return file_buffer[fp]
    }

    const bytes = fs.readFileSync(fp)
    file_buffer[fp] = bytes.toString('base64')
    return file_buffer[fp]
}

function Set_Real_Time(name, x, y, vx, vy, options) {
    real_time[name] = {
        x: x,
        y: y,
        vx: vx,
        vy: vy,
        options: options,
        time: Date.now()
    }
}

function Get_Real_Time() {
    const final = {}

    for (var [rt_object, { x, y, vx, vy, options, time }] of Object.entries(real_time)) {
        const delta = Date.now() - time
        if (delta > global.Game_Settings.real_time_timeout) {
            delete real_time[rt_object]
            continue
        }

        final[rt_object] = {
            x: x + vx,
            y: y + vy - (options.gravity || 0)
        }
    }

    return final
}

function isEmpty(obj) {
    for (const prop in obj) {
        if (Object.hasOwn(obj, prop)) {
            return false;
        }
    }

    return true;
}

async function Game_Loop() {
    global.tick_duration = 0
    global.tick_index = 0
    global.users = users
    global.users_connections = users_connections
    global.engine_store = {}
    global.network_handlers = []
    global.sprites = {}
    console.log("Loading scripts...")
    var files = fs.readdirSync("./scripts")
    console.log("Scripts found:", files.join(", "))
    var scripts = []
    for (var file of files) {
        if (!file.endsWith(".js")) continue
        const fp = "./scripts/" + file
        const module = await import(fp);
        console.log("Loaded:", fp);
        if (typeof module.init === "function") {
            await module.init();
        }
        scripts[file.replace(".js", "")] = module
    }
    console.log("All scripts have loaded!")

    console.log("Waiting for all players to connect...")
    //wait for all users to be ready
    await new Promise((resolve) => {
        const check = () => {
            for (var key of Object.keys(users_connections)) {
                if (users_connections[key].status == false) {
                    setTimeout(check, 500)
                    return
                }
            }
            resolve()
        }
        check()
    })
    console.log("All players connected!")

    console.log("Loading all ui scripts...")
    const ui_scripts = {}
    Object.entries(scripts).forEach(([__module_name__, script]) => {
        if (typeof script.ui_script == "function") {
            ui_scripts[__module_name__] = script.ui_script.toString()
        }
    })
    console.log("All ui scripts loaded!")

    console.log("Sending players ui scripts...")
    Object.values(users_connections).forEach(user => {
        user.channel.send(JSON.stringify({
            Game_Start: true,
            Setup: Ui_Setup.toString(),
            Scripts: ui_scripts,
            ping_frequency: global.Game_Settings.ping_frequency
        }))
    })
    console.log("Sent all ui scripts!")

    console.log("Waiting for all client ui scripts to finish...")
    //FIXME: wait for ui scripts to finish on all clients
    console.log("All client ui scripts done!")

    const incoming_messages = {}
    const outgoing_images = {}
    var ping_data = {}
    Object.keys(users_connections).forEach(user => {
        incoming_messages[user] = []
        outgoing_images[user] = []
    })
    Object.entries(global.users_connections).forEach(([user, s]) => {
        s.channel.onclose = async (e) => {
            console.log(`User ${user} has disconnected!`)
            delete global.users_connections[user]
            if (global.Game_Settings.close_on_no_users && isEmpty(global.users_connections)) {
                console.log("All users disconnected! Calling close functions...")
                clearInterval(tick)

                try {
                    for (var script of Object.values(scripts)) {
                        if (typeof script.close == "function") {
                            await script.close()
                        }
                    }
                    console.log("All close functions complete! Closing...")
                }
                catch (e) {
                    console.log("Error in close:", e)
                }

                process.exit()
            }
        }
        s.channel.onmessage = (msg) => {
            if (msg.type == "message") {
                const data = JSON.parse(msg.data)
                switch (data.type) {
                    case "message":
                        incoming_messages[user].push({ data: data.data, network: data.network_name })
                        break
                    case "image_request":
                        outgoing_images[user].push(data.sprite_id)
                        break
                    case "real_time":
                        Set_Real_Time(data.name, data.x, data.y, data.vx, data.vy, data.options)
                        break
                    case "ping":
                        ping_data[user] = Date.now() - data.timestamp
                        break
                }
            }
        }
    })

    var ping_with_next_message = false
    if (global.Game_Settings.ping_frequency >= 0) {
        setInterval(() => { ping_with_next_message = true }, global.Game_Settings.ping_frequency)
    }

    console.log("Entered pre-game state...")
    const internal_tick = async () => {
        const tick_start = Date.now()
        global.tick_index += 1
        // handle incoming messages
        try {
            for (var [uid, messages] of Object.entries(incoming_messages)) {
                for (var message of messages) {
                    for (var handler of global.network_handlers) {
                        handler._Handle_Message(uid, message)
                    }
                }

                incoming_messages[uid] = []
            }
        }
        catch (e) {
            console.log("Error while handling incoming messages:", e)
        }
        // run the tick function
        try {
            for (var script of Object.values(scripts)) {
                if (typeof script.tick == "function") {
                    await script.tick()
                }
            }
        }
        catch (e) {
            console.log("Error in tick:", e)
        }
        // send outgoing messages
        try {
            const message = {}
            for (var handler of global.network_handlers) {
                if (!handler.network_name) continue // handler is yet to send a message

                for (var uid of Object.keys(handler._message_buffer)) {
                    if (!message[uid]) message[uid] = {}

                    message[uid][handler.network_name] = [...(message[uid][handler.network_name] || []), ...handler._message_buffer[uid]]
                }
                handler._message_buffer = {}
            }
            for (var [uid, images] of Object.entries(outgoing_images)) {
                if (images.length == 0) continue
                if (!message[uid]) message[uid] = {}
                message[uid].__images__ = {}

                for (var image of images) {
                    if (!global.sprites[image]) {
                        console.log(`User requested unknown sprite '${image}'`)
                        continue
                    }
                    message[uid].__images__[image] = Buffer_File(global.sprites[image])
                }

                outgoing_images[uid] = []
            }

            if (global.Game_Settings.real_time) {
                const real_time = Get_Real_Time()
                for (var user of Object.keys(global.users_connections)) {
                    if (!message[user]) message[user] = {}
                    message[user].__real_time__ = real_time
                }
            }

            if (ping_with_next_message) {
                ping_with_next_message = false
                for (var user of Object.keys(global.users_connections)) {
                    if (!message[user]) message[user] = {}
                    message[user].__ping__ = ping_data
                }
            }

            for (var uid of Object.keys(message)) {
                const data = message[uid]
                const socket = global.users_connections[uid]
                if (!socket) {
                    continue
                    //console.warn("Unknown user id of", uid, "Available user ids include:", Object.keys(global.users_connections).join(", "))
                }
                try {
                    socket.channel.send(JSON.stringify(data))
                }
                catch (e) {
                    console.log("Error in socket:", socket.channel.readyState)
                    //console.log(e)
                }
            }
        }
        catch (e) {
            console.log("Error while sending game data:", e)
        }
        global.tick_duration = Date.now() - tick_start
    }
    const tick = setInterval(internal_tick, 1000 / global.Game_Settings.tick_rate)
    setTimeout(() => {
        console.log("Game Started!")
        global.game_started = true
    }, global.Game_Settings.start_counter * 1000)
}

async function Connect_To_User(user_id, socket) {
    users_connections[user_id] = {
        status: false
    }
    const pc = new wrtc.RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    global.pc = pc
    users_connections[user_id].pc = pc

    const channel = pc.createDataChannel("data");
    users_connections[user_id].channel = channel;

    pc.oniceconnectionstatechange = () => {
        if (!users_connections[user_id]) return
        users_connections[user_id].status = pc.iceConnectionState == "completed"

        if (pc.iceConnectionState == "completed") {
            socket.close()
            console.log("Player", user_id, "is ready!")
        }
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                bypass: {
                    RTC: {
                        candidate: event.candidate
                    }
                },
                user_id: user_id
            }));
        }
    };

    socket.on("message", async (data) => {
        const msg = JSON.parse(data)

        if (msg.RTC && msg.user_id == user_id) {
            if (msg.RTC.answer) {
                await pc.setRemoteDescription(msg.RTC.answer);
                console.log("Answer applied for", user_id);
            }
            if (msg.RTC.candidate) {
                await pc.addIceCandidate(msg.RTC.candidate);
            }
        }
    })

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.send(JSON.stringify({
        bypass: {
            room_start: true
        },
        user_id: user_id
    }))
    socket.send(JSON.stringify({
        bypass: {
            RTC: {
                offer: offer
            }
        },
        user_id: user_id
    }))
}

function Handle_Answer(code) {
    // Decode the Base64 string back into the combined format
    const decodedString = atob(code);
    // Split the string into components using ':' as a separator
    const [ip, port, auth] = decodedString.split(':');

    return { ip, port, auth }
}

function start({ ip, port, auth }) {
    console.log(`Connecting to ${ip}:${port}`)
    const socket = new WebSocket(`ws:${ip}:${port}?auth=${auth}`)
    const Start_Game = () => {
        console.log("Starting game...")
        users.forEach(user_id => {
            Connect_To_User(user_id, socket)
        })
        Game_Loop()
    }

    socket.on("message", async (event) => {
        const msg = JSON.parse(event)

        if (msg.msg) {
            console.log("Incoming message: '", msg.msg, "'")
        }
        if (msg.user_joined) {
            console.log("New user:", msg.user_joined)
            users.push(msg.user_joined)

            //FIXME: temp
            //Start_Game()
        }
        if (msg.host_confirmed) {
            console.log("Hosting game with room id:", msg.host_confirmed)
            room_id = msg.host_confirmed
        }
        if (msg._TEMP_start_room) {
            Start_Game()
        }
    })

    socket.on("open", () => {
        socket.send(JSON.stringify({ "register_host": true }))
    })
}

function Host_Client() {
    const server = http.createServer((req, res) => {
        if (req.url === '/' || req.url === '/index.html') {
            const filePath = path.join(__dirname, '../dist/client.html');

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Server error');
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data); // raw HTML, no transformation
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
        }
    });

    server.listen(3000, '0.0.0.0', () => console.log('Server listening on http://127.0.0.1:3000'));
}

global.Game_Settings = {
    start_counter: 0,
    tick_rate: 30,
    real_time: true,
    real_time_timeout: 5000,
    close_on_no_users: true,
    ping_frequency: 500
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})
rl.question("Host client? (Y/n): ", (answer) => answer.toLowerCase() != "n" && Host_Client());

//Game_Loop()
//    .catch(e => console.error(e))
start(Handle_Answer("MTI3LjAuMC4xOjgwODA6eGptYmx1b3dkdg=="))
//const rl = readline.createInterface({
//    input: process.stdin,
//    output: process.stdout,
//})
//rl.question("Enter Connection code: ", (answer) => start(Handle_Answer(answer)));