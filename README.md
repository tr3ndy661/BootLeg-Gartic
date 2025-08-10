# Multiplayer Gartic Phone

A real-time multiplayer drawing and guessing game built with HTML5, CSS3, JavaScript, Node.js, and Socket.IO.

## Features

- **Real-time Multiplayer**: Multiple players can join the same room
- **Live Drawing**: See other players drawing in real-time
- **Chat System**: Text chat with timestamps
- **Voice Chat**: Voice activation with microphone support
- **Room System**: Create or join specific rooms
- **Responsive Design**: Works on desktop and mobile

## Setup Instructions

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Server**:
   ```bash
   npm start
   ```

3. **Access the Game**:
   - Open your browser and go to `http://localhost:3000`
   - Enter your name and optionally a room ID
   - Share the room ID with friends to play together

## How to Play

1. Enter your name and join a room
2. Wait for other players to join
3. Click "Start Game" when ready
4. Draw the given prompt on the canvas
5. Use chat and voice to communicate
6. Submit your drawing when finished

## Port Forwarding

To play with friends over the internet:

1. Forward port 3000 on your router
2. Share your public IP address
3. Friends can access: `http://YOUR_PUBLIC_IP:3000`

## Technologies Used

- **Frontend**: HTML5 Canvas, CSS3, Vanilla JavaScript
- **Backend**: Node.js, Express.js
- **Real-time Communication**: Socket.IO
- **Voice Chat**: WebRTC MediaRecorder API