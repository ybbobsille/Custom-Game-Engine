function Get_Function_From_String(func_string) {
  var test = null
  eval(`test = ${func_string}`)
  return test
}

async function Handle_Game_Init(event) {
  RTC_log(event.data)
  const data = JSON.parse(event.data)

  if (data.Game_Start) {
    Get_Function_From_String(data.Setup)(data.Scripts, data.ping_frequency)
  }
}

async function Connect_To_Host(socket) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: `turn:${window.base_url}`,
        username: "user",
        credential: "pass"
      }
    ],
  });
  pc.oniceconnectionstatechange = () => {
    log("ICE: " + pc.iceConnectionState);
  }
  globalThis.pc = pc
  pc.ondatachannel = (event) => {
    const channel = event.channel;
    globalThis.channel = channel; // expose for console testing
    channel.onmessage = Handle_Game_Init;
    socket.close()

    log("Client DataChannel Ready: " + channel.readyState);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({
        bypass: {
          RTC: {
            candidate: event.candidate
          },
          user_id: window.user_id
        },
        room: window.room
      }));
    }
  };
  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    log("Signal:" + JSON.stringify(msg))

    if (msg.RTC) {
      if (msg.RTC.offer) {
        await pc.setRemoteDescription(msg.RTC.offer);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.send(JSON.stringify({
          bypass: {
            RTC: {
              answer: answer
            },
            user_id: window.user_id
          },
          room: window.room
        }))
      }
      if (msg.RTC.candidate) {
        await pc.addIceCandidate(msg.RTC.candidate);
      }
    }
  }
}

function RTC_log(msg) {
  const box = document.getElementById("RTClog")
  if (!box) return
  box.value += msg + "\n";
}