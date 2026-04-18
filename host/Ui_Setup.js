// this function will run on the client and will setup the system to allow each script to use there own scripts.
// the reason i do it this way is to alow old clients to load new games, or use a modified engine.
export default function Ui_Setup(ui_scripts, ping_frequency = -1) {
    console.log("running Ui_Setup...")

    Object.entries(ui_scripts).forEach(([module_name, func]) => {
        ui_scripts[module_name] = Get_Function_From_String(func)
    })
    const RTC = globalThis.pc
    const channel = globalThis.channel

    const channel_listeners = {}
    const image_buffer = {}

    var real_time_objects = {}
    var ping_data = {}

    const handle_message = (event) => {
        const data = JSON.parse(event.data)
        for (var network_name of Object.keys(data)) {
            if (network_name == "__images__") {
                Object.assign(image_buffer, Object.fromEntries(Object.entries(data[network_name]).map(([k, v]) => {
                    const img = new Image()
                    img.src = `data:image/png;base64,${v}`
                    return [k, img]
                })))
                continue
            }
            else if (network_name == "__real_time__") {
                real_time_objects = data[network_name]
                continue
            }
            else if (network_name == "__ping__") {
                ping_data = data[network_name]
                continue
            }
            else if (network_name == "__catch_up__") {
                for (var msg of data[network_name]) {
                    handle_message({
                        data: JSON.stringify({
                            [msg.network_name]: [msg.msg]
                        })
                    })
                }
                continue
            }
            if (!channel_listeners[network_name]) continue

            data[network_name].forEach(msg =>
                channel_listeners[network_name].forEach(listener => listener(msg))
            )
        }
    }

    channel.onmessage = handle_message

    if (ping_frequency != -1) {
        setInterval(() => {
            channel.send(JSON.stringify({
                timestamp: Date.now(),
                type: "ping"
            }))
        }, ping_frequency)
    }

    document.body.innerHTML = `
    <style>
    body {
        margin: 0;
        background-color: black;
    }

    canvas {
        border: 2px solid black;
        max-height: 100vh;
        max-width: 100vw;
        image-rendering: pixelated;
        position: absolute;
        left: 50vw;
        top: 50vh;
        transform: translate(-50%, -50%);
        margin: 0;
    }
    </style>

    <canvas width="500" height="500">
    </canvas>
    `

    const canvas = document.querySelector("canvas")
    const ctx = canvas.getContext("2d")
    var canvas_background = { r: 0, g: 0, b: 0 }

    function fitCanvas(canvas, width, height) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const canvasRatio = width / height;
        const screenRatio = vw / vh;

        // set internal resolution
        canvas.width = width;
        canvas.height = height;

        if (canvasRatio > screenRatio) {
            // fit to width
            canvas.style.width = "100vw";
            canvas.style.height = "auto";
        } else {
            // fit to height
            canvas.style.width = "auto";
            canvas.style.height = "100vh";
        }
    }

    function Get_Sprite(sprite_id) {
        if (image_buffer[sprite_id]) {
            return image_buffer[sprite_id]
        }
        else {
            throw new Error(`Sprite '${sprite_id}' does not exist! Did you forget to preload it? Or was it released?`)
        }
    }

    window.Keycode = Object.freeze({
        space: "Space",
        a: "KeyA",
        d: "KeyD",
        slash: "Slash",
        enter: "Enter",
        l: "KeyL"
    })

    const input_map = {}

    window.addEventListener("keydown", (e) => {
        if (input_map[e.code]) {
            console.log(e.code)
            input_map[e.code].held = true
            input_map[e.code].down = true
            requestAnimationFrame(() => input_map[e.code].down = false)
        }
        //else {
        //    console.log("Untracked key:", e.code)
        //}
    })
    window.addEventListener("keyup", (e) => {
        if (input_map[e.code]) {
            input_map[e.code].held = false
        }
    })

    const handler = {
        version: "1.0.1",
        uid: window.user_id,
        DOM: document.body,
        sprites: {
            Preload(sprite_id, timeout = 5000) {
                channel.send(JSON.stringify({
                    type: "image_request",
                    sprite_id: sprite_id
                }))

                return new Promise((resolve, reject) => {
                    const check = () => {
                        console.log(sprite_id, image_buffer)//, image_buffer[sprite_id] && image_buffer[sprite_id].complete, image_buffer[sprite_id] && image_buffer[sprite_id].naturalWidth !== 0)
                        if (image_buffer[sprite_id] && image_buffer[sprite_id].complete && image_buffer[sprite_id].naturalWidth !== 0) {
                            clearInterval(check_interval)
                            clearTimeout(_timeout)
                            resolve(sprite_id)
                        }
                    }

                    // add 10ms to give one last check
                    const _timeout = setTimeout(() => {
                        clearInterval(check_interval)
                        reject("Image request timed out!")
                    }, timeout + 10)
                    const check_interval = setInterval(check, 100)
                })
            },
            Release(sprite_id) {
                delete image_buffer[sprite_id]
            }
        },
        renderer: {
            adv: {
                Set_Pixel(x, y, r, g, b) {
                    handler.renderer.adv.Set_Square(x, y, 1, 1, r, g, b)
                },
                Set_Square(x, y, w, h, r, g, b) {
                    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
                    ctx.fillRect(x, y, w, h)
                    ctx.stroke()
                }
            },
            text: {
                Text_Type: Object.freeze({
                    small: "small"
                }),
                Text_Sizes: Object.freeze({
                    "small": { height: 6, width: 6 }
                }),
                Characters: {
                    _NAN(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)
                            renderer.Set_Square(x + 3, y, 1, 5, r, g, b)
                        }
                    },
                    ONE(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x, y + 4, 3, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x + 1, y, 1, 4, r, g, b)

                            // dot
                            renderer.Set_Pixel(x, y + 1, r, g, b)
                        }
                    },
                    TWO(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x, y + 4, 4, 1, r, g, b)
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)

                            // dot
                            renderer.Set_Pixel(x, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 2, r, g, b)
                            renderer.Set_Pixel(x + 1, y + 3, r, g, b)
                        }
                    },
                    THREE(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)

                            // dot
                            renderer.Set_Pixel(x, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 2, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 3, r, g, b)
                            renderer.Set_Pixel(x, y + 3, r, g, b)
                        }
                    },
                    FOUR(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x, y + 3, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x + 2, y, 1, 5, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 1, y + 1, r, g, b)
                            renderer.Set_Pixel(x, y + 2, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 3, r, g, b)
                        }
                    },
                    FIVE(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x, y, 4, 1, r, g, b)
                            renderer.Set_Square(x, y + 2, 3, 1, r, g, b)
                            renderer.Set_Square(x, y + 4, 3, 1, r, g, b)

                            // dot
                            renderer.Set_Pixel(x, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 3, r, g, b)
                        }
                    },
                    SIX(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x, y + 1, 1, 3, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 3, y + 3, r, g, b)
                        }
                    },
                    SEVEN(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x, y, 3, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x + 3, y + 1, 1, 2, r, g, b)
                            renderer.Set_Square(x + 2, y + 3, 1, 2, r, g, b)
                        }
                    },
                    EIGHT(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 3, y + 3, r, g, b)
                            renderer.Set_Pixel(x, y + 3, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 1, r, g, b)
                            renderer.Set_Pixel(x, y + 1, r, g, b)
                        }
                    },
                    NINE(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x + 3, y + 1, 1, 3, r, g, b)

                            // dot
                            renderer.Set_Pixel(x, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 4, r, g, b)
                        }
                    },
                    ZERO(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y + 1, 1, 3, r, g, b)
                            renderer.Set_Square(x + 4, y + 1, 1, 3, r, g, b)

                            // horizontal
                            renderer.Set_Square(x + 1, y, 3, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 3, 1, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 1, y + 3, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 2, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 1, r, g, b)
                        }
                    },
                    PERIOD(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // dot
                            renderer.Set_Pixel(x, y + 4, r, g, b)
                        }
                    },
                    A(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x, y + 1, 1, 4, r, g, b)
                            renderer.Set_Square(x + 3, y + 1, 1, 4, r, g, b)
                        }
                    },
                    B(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)

                            //horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)

                            // dots
                            renderer.Set_Pixel(x + 3, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 3, r, g, b)
                        }
                    },
                    C(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y + 1, 1, 3, r, g, b)

                            //horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)

                            // dots
                            renderer.Set_Pixel(x + 3, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 3, r, g, b)
                        }
                    },
                    D(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)
                            renderer.Set_Square(x + 3, y + 1, 1, 3, r, g, b)

                            //horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)
                        }
                    },
                    E(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)

                            //horizontal
                            renderer.Set_Square(x + 1, y, 3, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 3, 1, r, g, b)
                        }
                    },
                    F(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)

                            //horizontal
                            renderer.Set_Square(x + 1, y, 3, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)
                        }
                    },
                    G(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y + 1, 1, 3, r, g, b)
                            renderer.Set_Square(x + 3, y + 2, 1, 2, r, g, b)

                            //horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)

                            //dot
                            renderer.Set_Pixel(x + 2, y + 2, r, g, b)
                        }
                    },
                    H(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)
                            renderer.Set_Square(x + 3, y, 1, 5, r, g, b)
                        }
                    },
                    I(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x, y, 3, 1, r, g, b)
                            renderer.Set_Square(x, y + 4, 3, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x + 1, y + 1, 1, 3, r, g, b)
                        }
                    },
                    J(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x + 3, y, 1, 4, r, g, b)

                            // dot
                            renderer.Set_Pixel(x, y + 3, r, g, b)
                        }
                    },
                    K(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 3, y, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 1, y + 2, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 3, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 4, r, g, b)
                        }
                    },
                    L(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)

                            // horizontal
                            renderer.Set_Square(x + 1, y + 4, 3, 1, r, g, b)
                        }
                    },
                    M(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)
                            renderer.Set_Square(x + 4, y, 1, 5, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 1, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 2, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 1, r, g, b)
                        }
                    },
                    N(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)
                            renderer.Set_Square(x + 3, y, 1, 5, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 1, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 2, r, g, b)
                        }
                    },
                    O(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y + 1, 1, 3, r, g, b)
                            renderer.Set_Square(x + 3, y + 1, 1, 3, r, g, b)

                            // horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)
                        }
                    },
                    P(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 3, y + 1, r, g, b)
                        }
                    },
                    Q(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y + 1, 1, 3, r, g, b)
                            renderer.Set_Square(x + 3, y + 1, 1, 2, r, g, b)

                            // horizontal
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 1, y + 4, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 3, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 4, r, g, b)
                        }
                    },
                    R(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)
                            renderer.Set_Square(x + 1, y, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 3, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 3, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 4, r, g, b)
                        }
                    },
                    S(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y, 3, 1, r, g, b)
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)
                            renderer.Set_Square(x, y + 4, 3, 1, r, g, b)

                            // dot
                            renderer.Set_Pixel(x, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 3, r, g, b)
                        }
                    },
                    T(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x, y, 5, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x + 2, y + 1, 1, 4, r, g, b)
                        }
                    },
                    U(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // horizontal
                            renderer.Set_Square(x + 1, y + 4, 2, 1, r, g, b)

                            // vertical
                            renderer.Set_Square(x, y, 1, 4, r, g, b)
                            renderer.Set_Square(x + 3, y, 1, 4, r, g, b)
                        }
                    },
                    V(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 2, r, g, b)
                            renderer.Set_Square(x + 1, y + 2, 1, 2, r, g, b)
                            renderer.Set_Square(x + 3, y + 2, 1, 2, r, g, b)
                            renderer.Set_Square(x + 4, y, 1, 2, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 2, y + 4, r, g, b)
                        }
                    },
                    W(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 5, r, g, b)
                            renderer.Set_Square(x + 4, y, 1, 5, r, g, b)

                            // dot
                            renderer.Set_Pixel(x + 1, y + 4, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 3, r, g, b)
                            renderer.Set_Pixel(x + 3, y + 4, r, g, b)
                        }
                    },
                    X(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 2, r, g, b)
                            renderer.Set_Square(x + 4, y, 1, 2, r, g, b)
                            renderer.Set_Square(x, y + 3, 1, 2, r, g, b)
                            renderer.Set_Square(x + 4, y + 3, 1, 2, r, g, b)

                            // horizontal
                            renderer.Set_Square(x + 1, y + 2, 2, 1, r, g, b)
                        }
                    },
                    Y(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // vertical
                            renderer.Set_Square(x, y, 1, 2, r, g, b)
                            renderer.Set_Square(x + 4, y, 1, 2, r, g, b)
                            renderer.Set_Square(x + 2, y + 3, 1, 2, r, g, b)

                            // horizontal
                            renderer.Set_Square(x + 1, y + 2, 3, 1, r, g, b)
                        }
                    },
                    Z(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            //horizontal
                            renderer.Set_Square(x, y, 4, 1, r, g, b)
                            renderer.Set_Square(x, y + 4, 4, 1, r, g, b)

                            // dot
                            renderer.Set_Pixel(x, y + 3, r, g, b)
                            renderer.Set_Pixel(x + 1, y + 2, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 1, r, g, b)
                        }
                    },
                    LESS(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // dot
                            renderer.Set_Pixel(x + 2, y, r, g, b)
                            renderer.Set_Pixel(x + 1, y + 1, r, g, b)
                            renderer.Set_Pixel(x, y + 2, r, g, b)
                            renderer.Set_Pixel(x + 1, y + 3, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 4, r, g, b)
                        }
                    },
                    GREATER(x, y, type, r, g, b) {
                        const renderer = handler.renderer.adv
                        if (type == handler.renderer.text.Text_Type.small) {
                            // dot
                            renderer.Set_Pixel(x, y, r, g, b)
                            renderer.Set_Pixel(x + 1, y + 1, r, g, b)
                            renderer.Set_Pixel(x + 2, y + 2, r, g, b)
                            renderer.Set_Pixel(x + 1, y + 3, r, g, b)
                            renderer.Set_Pixel(x, y + 4, r, g, b)
                        }
                    }
                },
                Render(text, x, y, type, r = 0, g = 0, b = 0) {
                    const _text = handler.renderer.text
                    const Char_Map = {
                        ".": "period",
                        "1": "one",
                        "2": "two",
                        "3": "three",
                        "4": "four",
                        "5": "five",
                        "6": "six",
                        "7": "seven",
                        "8": "eight",
                        "9": "nine",
                        "0": "zero",
                        "<": "less",
                        ">": "greater"
                    }

                    var _x = x
                    var { height, width } = _text.Text_Sizes[type]
                    for (var char of text) {
                        if (char == "\n") {
                            _x = x
                            y += height
                            continue
                        }
                        else if (char == " ") {
                            _x += width
                            continue
                        }

                        char = Char_Map[char] || char;

                        //console.log(`Rendering character '${char.toUpperCase()}' at (${_x}, ${y})`);
                        (_text.Characters[char.toUpperCase()] || _text.Characters._NAN)(_x, y, type, r, g, b)
                        _x += width
                    }

                    return { x: _x, y: y }
                },
                Center(text, x, y, type) {
                    const char_size = handler.renderer.text.Text_Sizes[type]
                    const size = {
                        height: char_size.height,
                        width: char_size.width * text.length
                    }
                    return {
                        x: x - size.width / 2,
                        y: y - size.height / 2
                    }
                }
            },
            Flush() {
                handler.renderer.adv.Set_Square(
                    0, 0, canvas.width, canvas.height,
                    canvas_background.r, canvas_background.g, canvas_background.b
                )
            },
            Set_Background(r, g, b) {
                canvas_background = { r, g, b }
            },
            Resize_Canvas(x, y) {
                canvas.height = y
                canvas.width = x
                fitCanvas(canvas, x, y)
            },
            Render_Sprite(sprite_id, x, y) {
                ctx.drawImage(Get_Sprite(sprite_id), x, y)
            }
        },
        network: {
            network_name: null,
            on_message(network_name, callback) {
                if (!channel_listeners[network_name]) channel_listeners[network_name] = []

                channel_listeners[network_name].push(callback)
            },
            send(msg) {
                if (!this.network_name) {
                    throw new Error("Network name is not set")
                }

                channel.send(JSON.stringify({
                    data: msg,
                    network_name: this.network_name,
                    type: "message"
                }))
            },
            ping_user(uid) {
                return Math.max(ping_data[uid], 0)
            },
            real_time: {
                options: {},
                Set(name, x, y, vx, vy, options_override = null) {
                    channel.send(JSON.stringify({
                        type: "real_time",
                        name,
                        x, y,
                        vx, vy,
                        options: options_override || handler.network.real_time.options
                    }))
                },
                Get(name) {
                    return real_time_objects[name] || { x: 0, y: 0 }
                }
            }
        },
        input: {
            keydown(key) {
                return input_map[key].down
            },
            keyheld(key) {
                return input_map[key].held
            },
            track(key) {
                input_map[key] = {
                    down: false,
                    held: false
                }
            }
        },
        Clamp(value, min, max) {
            // clamps value between min and max
            return Math.min(max, Math.max(min, value))
        }
    }

    Object.values(ui_scripts).forEach(script => {
        script(handler)
    })
}