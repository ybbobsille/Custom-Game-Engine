import wrtc from "@roamhq/wrtc";
import readline from "node:readline";
import { WebSocket } from "ws";
import fs from "node:fs";

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

function Ui_Setup(ui_scripts) {
    // this function will run on the client and will setup the system to allow each script to use there own scripts.
    // the reason i do it this way is to alow old clients to load new games.
    console.log("running Ui_Setup...")

    Object.entries(ui_scripts).forEach(([module_name, func]) => {
        ui_scripts[module_name] = Get_Function_From_String(func)
    })
    const RTC = globalThis.pc
    const channel = globalThis.channel

    const channel_listeners = {}

    channel.onmessage = (event) => {
        const data = JSON.parse(event.data)
        for (var network_name of Object.keys(data)) {
            if (!channel_listeners[network_name]) continue

            data[network_name].forEach(msg => 
                channel_listeners[network_name].forEach(listener => listener(msg))
            )
        }
    }

    document.body.innerHTML = `
    <style>
    body {
        margin: 0;
        background-color: black;
    }

    canvas {
        border: 2px solid black;
        height: 100vh;
        aspect-ratio: 1/1;
        image-rendering: pixelated;
    }
    </style>

    <canvas width="500" height="500">
    </canvas>
    `

    const canvas = document.querySelector("canvas")
    const ctx = canvas.getContext("2d")

    const handler = {
        renderer: {
            Set_Pixel(x, y, r, g, b) {
                handler.renderer.Set_Square(x,y,1,1,r,g,b)
            },
            Set_Square(x,y,w,h,r,g,b) {
                ctx.fillStyle = `rgb(${[r,g,b].join(",")})`
                ctx.fillRect(y,x,w,h)
                ctx.stroke()
            },
            Size(x,y) {
                canvas.height = y
                canvas.width = x
            }
        },
        network: {
            on_message(network_name, callback) {
                if (!channel_listeners[network_name]) channel_listeners[network_name] = []

                channel_listeners[network_name].push(callback)
            },
            send(msg) {
                channel.send(JSON.stringify(msg))
            }
        }
    }

    Object.values(ui_scripts).forEach(script => {
        script(handler)
    })
}

async function Game_Loop() {
    global.tick_duration = 0
    global.tick_index = 0
    global.users = users
    global.users_connections = users_connections
    global.engine_store = {}
    global.network_handlers = []
    console.log("Loading scripts...")
    var files = fs.readdirSync("./scripts")
    console.log("Scripts found:", files.join(", "))
    var scripts = []
    for (var file of files) {
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
    Object.values(users_connections).forEach( user => {
        user.channel.send(JSON.stringify({
            Game_Start:true,
            Setup: Ui_Setup.toString(),
            Scripts: ui_scripts
        }))
    })
    console.log("Sent all ui scripts!")

    console.log("Waiting for all client ui scripts to finish...")
    //FIXME: wait for ui scripts to finish on all clients
    console.log("All client ui scripts done!")

    const incoming_messages = {}
    Object.keys(users_connections).forEach(user => {
        incoming_messages[user] = []
    })
    Object.entries(global.users_connections).forEach(([user, s]) => {
        s.channel.onclose = (e) => {
            console.error(user, "channel closed:", e)
        }
        s.channel.onmessage = (msg) => {
            if (msg.type == "message") {
                const data = JSON.parse(msg.data)
                incoming_messages[user] = data
            }
        }
    })

    console.log("Entered pre-game state...")
    const internal_tick = async () => {
        const tick_start = Date.now()
        global.tick_index += 1
        // handle incoming messages
        try {
            
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

            for (var uid of Object.keys(message)) {
                const data = message[uid]
                const socket = global.users_connections[uid]
                if (!socket) {
                    console.warn("Unknown user id of", uid, "Available user ids include:", Object.keys(global.users_connections).join(", "))
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

async function Handle_RTC_Data(event) {
    console.log(event.data)
}

async function Connect_To_User(user_id, socket) {
    users_connections[user_id] = {
        status:false
    }
    const pc = new wrtc.RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    global.pc = pc
    users_connections[user_id].pc = pc

    const channel = pc.createDataChannel("data");
    //channel.addEventListener("message", Handle_RTC_Data)
    users_connections[user_id].channel = channel;

    pc.oniceconnectionstatechange = () => {
      users_connections[user_id].status = pc.iceConnectionState == "completed"

      if (pc.iceConnectionState == "completed") {
        socket.close()
        console.log("Player", user_id, "is ready!")
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.send(JSON.stringify({
          bypass:{
            RTC: {
                candidate: event.candidate
            }
          },
          user_id:user_id
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
        bypass:{
            room_start:true
        },
        user_id:user_id
    }))
    socket.send(JSON.stringify({
        bypass:{
            RTC:{
                offer:offer
            }
        },
        user_id:user_id
    }))
}

function Handle_Answer(code) {
    const ip = code.split("_")[0].split("-").map(p => Base64.decode(p)).join(".")
    const port = code.split("_")[1].split("").map(p => Base64.decode(p)).join("")
    return { ip, port }
}

function start({ ip, port }) {
    console.log(`Connecting to ${ip}:${port}`)
    const socket = new WebSocket(`ws:${ip}:${port}`)
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
            Start_Game()
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
    start_counter:10,
    tick_rate:10
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})
rl.question("Host client? (Y/n): ", (answer) => answer.toLowerCase() != "n" && Host_Client());

//Game_Loop()
//    .catch(e => console.error(e))
start(Handle_Answer("B/-A-A-B_IAIA"))
//const rl = readline.createInterface({
//    input: process.stdin,
//    output: process.stdout,
//})
//rl.question("Enter Connection code: ", (answer) => start(Handle_Answer(answer)));