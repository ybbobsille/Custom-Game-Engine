var Base64 = {

    ALPHA: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
    encode: function (value) {

        if (typeof(value) !== 'number') {
            throw 'Value is not number!';
        }

        var result = '', mod;
        do {
            mod = value % 64;
            result = Base64.ALPHA.charAt(mod) + result;
            value = Math.floor(value / 64);
        } while(value > 0);

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

const log = (msg) => {
    document.getElementById("log").value += msg + "\n";
};

function Join_Lobby(code) {
    const socket = window.socket
    window.room = code
    socket.send(JSON.stringify({user_join_room: code}))
}

function decodeConnectionInfo(encodedString) {
    // Decode the Base64 string back into the combined format
    const decodedString = atob(encodedString);
    // Split the string into components using ':' as a separator
    const [ip, port, auth] = decodedString.split(':');
    // Return the decoded components
    return { ip, port, auth };
}

function Connect(code) {
    const {ip, port, auth} = decodeConnectionInfo(code)

    log(`Connecting to Ip: ${ip}:${port}`)

    window.url_base = `${ip}:${port}`

    const socket = new WebSocket(`ws://${ip}:${port}?auth=${auth}`);
    window.socket = socket

    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.room_start) {
            Connect_To_Host(socket)
        }
        if (msg.user_confitmed) {
            window.user_id = msg.user_confitmed
        }

        log("incoming messsage: " + JSON.stringify(msg))
    };

    socket.onopen = async () => {
        socket.send(JSON.stringify({register_user:true}))
    }
}

const state_update = setInterval(() => {
    const state = document.getElementById("State")
    if (!state) {
        clearInterval(state_update)
        return 
    }
    state.innerHTML = `
    Status:
    Signal socket: ${window.socket?.readyState}
    ICE: ${globalThis.pc?.iceConnectionState}
    RTC Channel: ${globalThis.channel?.readyState}
    `.replace(/\n/g, "<br>")
}, 100)