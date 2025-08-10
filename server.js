const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

const rooms = new Map();
const players = new Map();

class GameRoom {
    constructor(id) {
        this.id = id;
        this.players = [];
        this.currentRound = 0;
        this.currentDrawerIndex = 0;
        this.gameState = 'waiting'; // waiting, drawing, guessing, results
        this.drawings = [];
        this.prompts = [
            "A cat wearing a hat", "Pizza with unusual toppings", "Robot doing yoga",
            "Superhero walking a dog", "Alien playing guitar", "Dragon reading a book",
            "Penguin surfing", "Wizard making coffee", "Dinosaur riding a bicycle"
        ];
        this.currentPrompt = '';
        this.roundTimer = null;
        this.roundDuration = 60000; // 60 seconds
        this.correctGuesses = new Set();
    }

    addPlayer(player) {
        this.players.push(player);
        player.room = this.id;
    }

    removePlayer(playerId) {
        this.players = this.players.filter(p => p.id !== playerId);
    }

    startGame() {
        console.log(`Attempting to start game with ${this.players.length} players`);
        if (this.players.length < 1) return false; // Allow single player for testing
        this.gameState = 'drawing';
        this.currentPrompt = this.prompts[Math.floor(Math.random() * this.prompts.length)];
        this.currentDrawerIndex = 0;
        this.correctGuesses.clear();
        console.log(`Game started with prompt: ${this.currentPrompt}`);
        return true;
    }

    getCurrentDrawer() {
        return this.players[this.currentDrawerIndex];
    }

    nextTurn() {
        this.currentDrawerIndex = (this.currentDrawerIndex + 1) % this.players.length;
        this.currentPrompt = this.prompts[Math.floor(Math.random() * this.prompts.length)];
        this.correctGuesses.clear();
        this.currentRound++;
    }

    checkGuess(message, playerId) {
        const cleanMessage = message.toLowerCase().trim();
        const cleanPrompt = this.currentPrompt.toLowerCase().trim();
        return cleanMessage === cleanPrompt || cleanMessage.includes(cleanPrompt.split(' ')[0]);
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (data) => {
        const { roomId, playerName } = data;
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new GameRoom(roomId));
        }
        
        const room = rooms.get(roomId);
        const player = {
            id: socket.id,
            name: playerName,
            room: roomId,
            isDrawing: false
        };
        
        players.set(socket.id, player);
        room.addPlayer(player);
        socket.join(roomId);
        
        io.to(roomId).emit('player-joined', {
            players: room.players,
            message: `${playerName} joined the room`
        });
        
        socket.emit('room-joined', {
            roomId,
            players: room.players,
            gameState: room.gameState
        });
    });

    socket.on('start-game', () => {
        const player = players.get(socket.id);
        if (!player) {
            console.log('Player not found for start-game');
            return;
        }
        
        const room = rooms.get(player.room);
        if (!room) {
            console.log('Room not found for start-game');
            return;
        }
        
        console.log(`Starting game in room ${player.room} with ${room.players.length} players`);
        
        if (room.startGame()) {
            const currentDrawer = room.getCurrentDrawer();
            console.log(`Game started, current drawer: ${currentDrawer ? currentDrawer.name : 'none'}`);
            
            io.to(player.room).emit('game-started', {
                prompt: room.currentPrompt,
                gameState: room.gameState,
                currentDrawer: currentDrawer,
                round: room.currentRound + 1
            });
        } else {
            console.log('Failed to start game - not enough players');
            socket.emit('game-error', {
                message: 'Need at least 2 players to start the game'
            });
        }
    });

    socket.on('drawing-data', (data) => {
        const player = players.get(socket.id);
        if (!player) return;
        
        const room = rooms.get(player.room);
        if (!room) return;
        
        const currentDrawer = room.getCurrentDrawer();
        if (currentDrawer && currentDrawer.id === socket.id) {
            socket.to(player.room).emit('drawing-update', {
                playerId: socket.id,
                playerName: player.name,
                ...data
            });
        }
    });

    socket.on('next-turn', () => {
        const player = players.get(socket.id);
        if (!player) return;
        
        const room = rooms.get(player.room);
        if (!room) return;
        
        const currentDrawer = room.getCurrentDrawer();
        if (currentDrawer && currentDrawer.id === socket.id) {
            room.nextTurn();
            const newDrawer = room.getCurrentDrawer();
            
            io.to(player.room).emit('turn-changed', {
                prompt: room.currentPrompt,
                currentDrawer: newDrawer,
                round: room.currentRound + 1
            });
        }
    });

    socket.on('chat-message', (data) => {
        const player = players.get(socket.id);
        if (!player) return;
        
        const room = rooms.get(player.room);
        if (!room) return;
        
        const currentDrawer = room.getCurrentDrawer();
        const isDrawer = currentDrawer && currentDrawer.id === socket.id;
        
        // Check if it's a correct guess
        if (!isDrawer && room.gameState === 'drawing' && room.checkGuess(data.message, socket.id)) {
            if (!room.correctGuesses.has(socket.id)) {
                room.correctGuesses.add(socket.id);
                
                io.to(player.room).emit('correct-guess', {
                    playerId: socket.id,
                    playerName: player.name,
                    message: data.message,
                    timestamp: new Date().toLocaleTimeString()
                });
                
                // Check if all players guessed correctly
                if (room.correctGuesses.size === room.players.length - 1) {
                    setTimeout(() => {
                        room.nextTurn();
                        const newDrawer = room.getCurrentDrawer();
                        
                        io.to(player.room).emit('turn-changed', {
                            prompt: room.currentPrompt,
                            currentDrawer: newDrawer,
                            round: room.currentRound + 1
                        });
                    }, 2000);
                }
                return;
            }
        }
        
        // Regular chat message
        io.to(player.room).emit('chat-message', {
            playerId: socket.id,
            playerName: player.name,
            message: data.message,
            timestamp: new Date().toLocaleTimeString(),
            isDrawer: isDrawer
        });
    });

    socket.on('voice-state', (data) => {
        const player = players.get(socket.id);
        if (!player) return;
        
        socket.to(player.room).emit('player-voice-state', {
            playerId: socket.id,
            playerName: player.name,
            isActive: data.isActive
        });
    });

    socket.on('webrtc-offer', (data) => {
        socket.to(data.targetId).emit('webrtc-offer', {
            offer: data.offer,
            senderId: socket.id
        });
    });

    socket.on('webrtc-answer', (data) => {
        socket.to(data.targetId).emit('webrtc-answer', {
            answer: data.answer,
            senderId: socket.id
        });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.targetId).emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            senderId: socket.id
        });
    });

    socket.on('disconnect', () => {
        const player = players.get(socket.id);
        if (player) {
            const room = rooms.get(player.room);
            if (room) {
                room.removePlayer(socket.id);
                io.to(player.room).emit('player-left', {
                    players: room.players,
                    message: `${player.name} left the room`
                });
                
                if (room.players.length === 0) {
                    rooms.delete(player.room);
                }
            }
            players.delete(socket.id);
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});