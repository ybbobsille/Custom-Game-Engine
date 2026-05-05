import engine from "../engine.js"
engine.Register("Main", "1.0.0")
engine.network_name = "ybbobsille_main_4/4/2026"
engine.Vcheck("1.0.0")

var users = {}
var chat_messages = []

function Update_Users() {
    engine.network.Send_All({
        type: "users_update",
        users: users
    })
}

function Add_Chat_Message(owner, message) {
    if (chat_messages.length >= 5) {
        chat_messages.shift()
    }

    chat_messages.push([owner, message])

    engine.network.Send_All({
        type: "chat_update",
        messages: chat_messages
    })
}

export function On_User_Leave(uid) {
    delete users[uid]
    Update_Users()
}

export async function init() {
    engine.sprites.Register_New("character", "scripts/sprites/test.png")

    engine.network.Send_All({
        type: "init"
    }, true)

    engine.network.On_Message(engine.network_name, (user, msg) => {
        switch (msg.type) {
            case "ready":
                users[user] = msg.username
                Update_Users()
                Add_Chat_Message("game", `${msg.username} joined the game`)
                break
            case "chat":
                Add_Chat_Message(user, msg.msg)
                break
        }
    })
}

export async function ui_script(handler) {
    const network_name = "ybbobsille_main_4/4/2026"
    handler.network.network_name = network_name
    const character_size = { x: 30, y: 50 }
    const canvas_size = { x: 700, y: 500 }
    const jump_strength = 3
    const bounding_box = {
        min_y: 20 + character_size.y,
        max_y: canvas_size.y,
        max_x: canvas_size.x - character_size.x,
        min_x: 0
    }
    const target_step = 16 // ~60 fps
    const gravity = 0.1 / target_step
    const movement_speed = 3 / target_step
    var users = null
    var chat_data = []
    var joined
    var logs = ""
    var saved_logs = false

    const chat_user_color = [0, 255, 0]
    const chat_text_color = [255, 255, 255]
    const chat_game_color = [0, 0, 255]
    const chat_text_type = handler.renderer.text.Text_Type.small

    //char data
    var my_position = { x: 200, y: 200 }
    var my_velocity = { x: 0, y: 0 }
    var my_username = null
    var grounded = false
    var in_menu = false

    function saveTextFile(filename, text) {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
    }

    async function Loading(message, promise) {
        var period_count = 1
        const loading_interval = setInterval(() => {
            handler.renderer.Flush()
            const _message = message + ".".repeat(period_count)
            const char_type = handler.renderer.text.Text_Type.small
            const pos = handler.renderer.text.Center(_message, 350, 250, char_type)
            handler.renderer.text.Render(_message, pos.x, pos.y, char_type, 255, 255, 255)

            period_count++
            if (period_count > 3) {
                period_count = 0
            }
        }, 500)

        const result = await promise

        clearInterval(loading_interval)

        return result
    }

    async function Init() {
        // renderer config
        handler.renderer.Resize_Canvas(canvas_size.x, canvas_size.y)
        handler.renderer.Set_Background(50, 50, 50)

        // real_time config
        handler.network.real_time.options = {
            gravity: gravity
        }

        const load = async () => {
            handler.input.track(Keycode.a)
            handler.input.track(Keycode.d)
            handler.input.track(Keycode.space)
            handler.input.track(Keycode.slash)
            handler.input.track(Keycode.enter)
            handler.input.track(Keycode.l)

            await handler.sprites.Preload("character")
        }

        await Loading("Loading", load())

        Username()
    }

    async function Username() {
        const username_input = document.createElement("input")
        Object.assign(username_input.style, {
            position: "absolute",
            left: "50vw",
            top: "30vh",
            transform: "translate(-50%, -50%)"
        })
        handler.DOM.appendChild(username_input)

        const username_confirm = document.createElement("button")
        Object.assign(username_confirm.style, {
            position: "absolute",
            left: "50vw",
            top: "35vh",
            transform: "translate(-50%, -50%)"
        })
        username_confirm.innerHTML = "Confirm"
        handler.DOM.appendChild(username_confirm)

        const renderer = handler.renderer
        const text = handler.renderer.text

        const text_type = text.Text_Type.small

        const prompt = "input username"
        const prompt_pos = text.Center(prompt, 350, 120, text_type)

        const refresh = () => {
            handler.renderer.Flush()

            text.Render(prompt, prompt_pos.x, prompt_pos.y, text_type, 255, 255, 255)

            const username = username_input.value
            const username_pos = text.Center(username, 350, 200, text_type)
            text.Render(username, username_pos.x, username_pos.y, text_type, 255, 255, 255)
        }

        username_input.addEventListener("input", refresh)
        username_confirm.addEventListener("click", async () => {
            renderer.Flush()

            handler.DOM.removeChild(username_input)
            handler.DOM.removeChild(username_confirm)

            await Loading("Waiting for server", new Promise((resolve) => {
                handler.network.send({
                    type: "ready",
                    username: username_input.value
                })

                function check() {
                    if (users) {
                        resolve()
                    }
                    else {
                        setTimeout(check, 100)
                    }
                }

                setTimeout(check, 100)
            }))

            Main(username_input.value)
        })
        refresh()
    }

    async function Main(username) {
        my_username = username
        joined = Date.now()
        setInterval(Tick, target_step)
        setInterval(() => {
            handler.network.real_time.Set(handler.uid, my_position.x, my_position.y, my_velocity.x, my_velocity.y)
        }, target_step * 3)
    }

    function Ping_Color(ping) {
        if (ping > 1000) {
            return {
                r: 255,
                g: 0,
                b: 0
            }
        }
        else if (ping > 500) {
            return {
                r: 255,
                g: 153,
                b: 0
            }
        }
        else if (ping > 200) {
            return {
                r: 204,
                g: 255,
                b: 0
            }
        }
        else if (ping > 100) {
            return {
                r: 34,
                g: 177,
                b: 76
            }
        }
        else {
            return {
                r: 0,
                g: 255,
                b: 72
            }
        }
    }

    function Render_Character(username, position, ping) {
        const ping_color = Ping_Color(ping)

        const char_pos = {
            x: position.x,
            y: canvas_size.y - position.y
        }

        const username_text_type = handler.renderer.text.Text_Type.small
        const username_pos = handler.renderer.text.Center(username, char_pos.x + (character_size.x / 2), char_pos.y - 15, username_text_type)
        const ping_pos = handler.renderer.text.Render(username, username_pos.x, username_pos.y, username_text_type, 255, 255, 255)
        handler.renderer.text.Render(` ${ping}`, ping_pos.x, ping_pos.y, username_text_type, ping_color.r, ping_color.g, ping_color.b)

        handler.renderer.Render_Sprite("character", char_pos.x, char_pos.y)
    }

    function Display_Chat() {
        const _text = handler.renderer.text
        var position = { x: 20, y: 20 }
        for (var [owner, message] of chat_data) {
            const x = _text.Render(`<${users[owner]}> `, position.x, position.y, chat_text_type, ...(owner == "game" ? chat_game_color : chat_user_color)).x
            position.y = _text.Render(`${message}\n`, x, position.y, chat_text_type, ...(owner == "game" ? chat_game_color : chat_text_color)).y + 5
        }
    }

    function Simulate_Character(x, y, vx, vy, delta) {
        return {
            x: handler.Clamp(x + (vx * delta), bounding_box.min_x, bounding_box.max_x),
            y: handler.Clamp(y + (vy * delta), bounding_box.min_y, bounding_box.max_y)
        }
    }

    async function Tick() {
        handler.renderer.Flush()

        //#region other players
        for (var [uid, username] of Object.entries(users)) {
            if (uid == handler.uid) continue

            const position = handler.network.real_time.Get(uid)

            Render_Character(username, position, handler.network.ping_user(uid))
        }
        //#endregion

        //#region movement
        if (grounded) {
            if (!in_menu && handler.input.keyheld(Keycode.space)) {
                my_velocity.y = jump_strength
                grounded = false
            }
        }
        else {
            my_velocity.y -= gravity
        }

        my_velocity.x = in_menu ? 0 : ((handler.input.keyheld(Keycode.a) ? -1 : 0) + (handler.input.keyheld(Keycode.d) ? 1 : 0)) * movement_speed

        //my_position.y = handler.Clamp(my_position.y + my_velocity.y, bounding_box.min_y, bounding_box.max_y)
        //my_position.x = handler.Clamp(my_position.x + my_velocity.x, bounding_box.min_x, bounding_box.max_x)
        my_position = Simulate_Character(my_position.x, my_position.y, my_velocity.x, my_velocity.y, target_step)

        if (my_position.y == bounding_box.min_y) {
            grounded = true
            my_velocity.y = 0
        }

        Render_Character(my_username, my_position, handler.network.ping_user(uid))
        //#endregion

        //#region chat
        Display_Chat()

        if (Date.now() - joined < 10000) {
            handler.renderer.text.Center("press forward slash to chat",
                350, 100, handler.renderer.text.Text_Type.small)
        }

        if (handler.input.keyheld(Keycode.slash) && !in_menu) {
            in_menu = true

            const menu = document.createElement("input")
            menu.placeholder = "Type chat message"
            Object.assign(menu.style, {
                position: "absolute",
                left: "50vw",
                top: "50vh",
                transform: "translate(-50%, -50%)"
            })
            const check = () => {
                if (handler.input.keyheld(Keycode.enter)) {
                    clearInterval(interval)
                    handler.DOM.removeChild(menu)

                    in_menu = false

                    handler.network.send({
                        type: "chat",
                        msg: menu.value
                    })
                }
            }
            const interval = setInterval(check, 5)

            handler.DOM.appendChild(menu)
            menu.focus()
        }
        //#endregion

        //#region logs
        if (handler.input.keyheld(Keycode.l) && !saved_logs && !in_menu) {
            saveTextFile(`${handler.uid}_logs.txt`, logs)
            saved_logs = true
        }
        else if (!saved_logs) {
            logs += `\n${JSON.stringify(window.ping_data)}`
        }
        //#endregion
    }

    handler.network.on_message(network_name, msg => {
        switch (msg.type) {
            case "init":
                Init()
                break
            case "users_update":
                logs += `\nUSERS: ${JSON.stringify(msg.users)}`
                users = msg.users
                break
            case "chat_update":
                chat_data = msg.messages
                break
            default:
                alert(`Unknown incomming message: ${JSON.stringify(msg)}`)
        }
    })
}