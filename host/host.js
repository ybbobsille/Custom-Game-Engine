import fs from "fs";
import Ui_Setup from "./Ui_Setup.js";
import Networking from "./Networking.js"

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

function Set_Real_Time(name, x, y, vx, vy, time) {
    real_time[name] = {
        x: x,
        y: y,
        vx: vx,
        vy: vy,
        time: Date.now()
    }
}

function Get_Real_Time() {
    return real_time
}

async function Load_Game_Scripts() {
    global.Backend_Log("Loading game scripts...")
    var files = fs.readdirSync("./scripts")
    global.Backend_Log(`Game scripts found: ${files.filter(f => f.endsWith(".js")).join(", ")}. Loading...`)
    var scripts = {}
    try {
        for (var file of files) {
            if (!file.endsWith(".js")) continue

            const fp = `./scripts/${file}`
            const module = await import(fp)
            const has_init = typeof module.init === "function"
            global.Backend_Log(`Loaded game script: ${fp}.${has_init ? " Running init..." : ""}`)

            if (has_init) {
                await module.init()
            }

            scripts[file.replace(".js", "")] = module
        }
    }
    catch (e) {
        global.Backend_Log(`Error while loading game scripts: ${e}`)
        Close()
    }

    global.Backend_Log("All game scripts loaded!")

    return scripts
}

function Load_Ui_Scripts(scripts) {
    global.Backend_Log("Loading ui scripts...")
    const ui_scripts = {}
    Object.entries(scripts).forEach(([__module_name__, script]) => {
        if (typeof script.ui_script == "function") {
            ui_scripts[__module_name__] = script.ui_script.toString()
        }
    })
    global.Backend_Log("All scripts loaded!")
    return ui_scripts
}

function Get_Buffered_Messages() {
    const messages = []
    for (var handler of global.network_handlers) {
        for (var msg of handler._perminant_buffer) {
            messages.push(msg)
        }
    }
    return {
        __catch_up__: messages.sort((a, b) => a.t - b.t)
    }
}

async function Start_Game() {
    var scripts = await Load_Game_Scripts()
    const ui_scripts = Load_Ui_Scripts(scripts)

    const incoming_messages = {}
    const outgoing_sprites = {}
    var ping_data = {}
    global.tick_index = 0

    Networking.signal.on_user = async (user) => {
        const buffered_messages = Get_Buffered_Messages()
        const send_buffered = !Is_Object_Empty(buffered_messages)
        global.Network_Log(`Sending user ${user.uid} init${send_buffered ? " and buffered messages" : ""}...`)
        user.Send({
            Game_Start: true,
            Setup: Ui_Setup.toString(),
            Scripts: ui_scripts,
            ping_frequency: global.Game_Settings.ping_frequency || 1000
        })
        if (send_buffered) {
            user.Send(buffered_messages)
        }

        for (var script of Object.values(scripts)) {
            if (typeof script.On_User_Join == "function") {
                await script.On_User_Join(uid)
            }
        }

        const uid = user.uid
        incoming_messages[uid] = []
        outgoing_sprites[uid] = []

        user.on_close = async (e) => {
            for (var script of Object.values(scripts)) {
                if (typeof script.On_User_Leave == "function") {
                    await script.On_User_Leave(uid)
                }
            }

            if (global.Game_Settings.close_on_no_users && Networking.user_ids.length == 0) {
                global.Backend_Log(`All users disconnected! Calling close functions...`)

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

                close()
            }
        }
        user.on_message = async (msg) => {
            if (msg.type == "message") {
                const data = JSON.parse(msg.data)
                switch (data.type) {
                    case "message":
                        incoming_messages[uid].push({
                            data: data.data,
                            network: data.network_name
                        })
                        break
                    case "image_request":
                        outgoing_sprites[uid].push(data.sprite_id)
                        break
                    case "real_time":
                        Set_Real_Time(data.name, data.x, data.y, data.vx, data.vy, data.time)
                        break
                    case "ping":
                        ping_data[uid] = Date.now() - data.timestamp
                        break
                }
            }
        }
    }

    var ping_with_next_message = false
    if (global.Game_Settings.ping_frequency >= 0) {
        setInterval(() => {
            ping_with_next_message = true
        }, global.Game_Settings.ping_frequency)
    }

    global.Backend_Log(`Game init complete! Starting main loop...`)
    const main_tick = async () => {
        const tick_start = Date.now()
        global.tick_index += 1

        // handle incoming messages
        try {
            for (var [uid, messages] of Object.entries(incoming_messages)) {
                for (var _message of messages) {
                    for (var handler of global.network_handlers) {
                        handler._Handle_Message(uid, _message)
                    }
                }

                incoming_messages[uid] = []
            }
        }
        catch (e) {
            global.Backend_Log(`Error while handling incoming messages: ${e}`)
        }

        // run tick functions
        try {
            for (var script of Object.values(scripts)) {
                if (typeof script.tick == "function") {
                    await script.tick()
                }
            }
        }
        catch (e) {
            global.Backend_Log(`Error in tick: ${e}`)
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
            for (var [uid, images] of Object.entries(outgoing_sprites)) {
                if (images.length == 0) continue
                if (!message[uid]) message[uid] = {}
                message[uid].__images__ = {}

                for (var image of images) {
                    if (!global.sprites[image]) {
                        global.Backend_Log(`User requested unknown sprite '${image}'`)
                        continue
                    }
                    message[uid].__images__[image] = Buffer_File(global.sprites[image])
                }

                outgoing_sprites[uid] = []
            }

            if (global.Game_Settings.real_time) {
                const real_time = Get_Real_Time()
                for (var user of global.user_ids) {
                    if (!message[user]) message[user] = {}
                    message[user].__real_time__ = real_time
                }
            }

            if (ping_with_next_message) {
                ping_with_next_message = false
                for (var user of global.user_ids) {
                    if (!message[user]) message[user] = {}
                    message[user].__ping__ = ping_data
                }
            }

            for (var uid of Object.keys(message)) {
                const data = message[uid]
                const socket = Networking.user_connections[uid]
                if (!socket) {
                    continue
                    //console.warn("Unknown user id of", uid, "Available user ids include:", Object.keys(global.users_connections).join(", "))
                }
                try {
                    socket.Send(data)
                }
                catch (e) {
                    global.Backend_Log(`Error in socket: ${e}`)
                    //console.log(e)
                }
            }
        }
        catch (e) {
            global.Backend_Log(`Error while sending messages: ${e}`)
        }

        global.tick_duration = Date.now() - tick_start
        if (!global.Game_Settings.ignore_low_tick_rate && global.tick_duration > 1000 / global.Game_Settings.tick_rate) {
            global.Backend_Log(`Tick rate was lower than expected on tick ${global.tick_index}!`)
        }
    }
    const tick = setInterval(main_tick, 1000 / global.Game_Settings.tick_rate)
}

function Is_Object_Empty(obj) {
    for (const prop in obj) {
        if (Object.hasOwn(obj, prop)) {
            return false;
        }
    }

    return true;
}

async function Close() {
    await Networking.signal.Disconnect()
    process.exit()
}

async function Start() {
    await Start_Game()

    await Networking.signal.Connect()
}

function Load() {
    const config = JSON.parse(fs.readFileSync("./config.json"))

    // maybe helpful once implementing custom cli
    const _log = console.log
    //console.log = (text) => _log(text)

    global.Game_Settings = config.game
    global._network_settings = {
        ip: process.env.ip,
        port: process.env.port,
        auth: process.env.auth
    }
    global.network_handlers = []
    global.engine_store = {}
    global.sprites = {}
    global.message_buffer = []
    global.__set_real_time = Set_Real_Time
    global.__real_time = real_time
    global.Network_Log = (text) => _log(text)
    global.Backend_Log = (text) => _log(text)
}

Load()
Start()