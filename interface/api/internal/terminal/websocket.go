package terminal

import (
	"encoding/binary"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

const (
	msgInput  = 0x00 // client → server: raw terminal input
	msgResize = 0x01 // client → server: 4 bytes cols(u16BE) + rows(u16BE)
	msgOutput = 0x02 // server → client: raw terminal output
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (h *Handler) handleWS(w http.ResponseWriter, r *http.Request) {
	sessionName := r.URL.Query().Get("session")
	if sessionName == "" {
		sessionName = "default"
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade error: %v", err)
		return
	}
	defer conn.Close()

	session, err := h.sessions.GetOrCreate(sessionName)
	if err != nil {
		log.Printf("session %q error: %v", sessionName, err)
		conn.WriteMessage(websocket.BinaryMessage, append([]byte{msgOutput}, []byte("failed to start session: "+err.Error()+"\r\n")...)) //nolint:errcheck
		return
	}

	subID, ch := session.Subscribe()
	defer session.Unsubscribe(subID)

	// Serialize concurrent WebSocket writes (gorilla/websocket is not safe for
	// concurrent writes).
	var writeMu sync.Mutex
	writeBinary := func(data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(websocket.BinaryMessage, data)
	}

	// Session output → WebSocket
	go func() {
		for chunk := range ch {
			msg := make([]byte, 1+len(chunk))
			msg[0] = msgOutput
			copy(msg[1:], chunk)
			if err := writeBinary(msg); err != nil {
				return
			}
		}
	}()

	// WebSocket → Session input
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if len(msg) < 1 {
			continue
		}
		switch msg[0] {
		case msgInput:
			if err := session.WriteInput(msg[1:]); err != nil {
				return
			}
		case msgResize:
			if len(msg) < 5 {
				continue
			}
			cols := binary.BigEndian.Uint16(msg[1:3])
			rows := binary.BigEndian.Uint16(msg[3:5])
			session.Resize(cols, rows)
		}
	}
}
