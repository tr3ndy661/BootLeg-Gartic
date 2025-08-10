class MultiplayerGarticPhone {
    constructor() {
        this.socket = io();
        this.canvas = document.getElementById('drawingCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.voiceActive = false;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.playerName = '';
        this.roomId = '';
        this.players = [];
        this.currentDrawer = null;
        this.isMyTurn = false;
        this.peerConnections = new Map();
        this.mutedPlayers = new Set();
        
        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.setupSocketListeners();
        this.disableDrawing();
    }

    setupCanvas() {
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());
        
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.canvas.dispatchEvent(new MouseEvent('mouseup', {}));
        });
    }

    setupEventListeners() {
        document.getElementById('joinGame').addEventListener('click', () => this.joinGame());
        document.getElementById('playerName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinGame();
        });
        document.getElementById('roomId').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinGame();
        });
        
        document.getElementById('startGame').addEventListener('click', () => this.startGame());
        document.getElementById('clearCanvas').addEventListener('click', () => this.clearCanvas());
        document.getElementById('nextTurn').addEventListener('click', () => this.nextTurn());
        document.getElementById('voiceToggle').addEventListener('click', () => this.toggleVoice());
        document.getElementById('micTest').addEventListener('click', () => this.testMic());
        document.getElementById('sendMessage').addEventListener('click', () => this.sendMessage());
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        document.getElementById('colorPicker').addEventListener('change', (e) => {
            this.ctx.strokeStyle = e.target.value;
        });
        
        document.getElementById('brushSize').addEventListener('input', (e) => {
            this.ctx.lineWidth = e.target.value;
        });
    }

    setupSocketListeners() {
        this.socket.on('room-joined', (data) => {
            this.roomId = data.roomId;
            this.players = data.players;
            this.showGameScreen();
            this.updateRoomInfo();
            this.updatePlayersList();
            this.addSystemMessage(`Joined room: ${this.roomId}`);
        });

        this.socket.on('player-joined', (data) => {
            this.players = data.players;
            this.updatePlayersList();
            this.addSystemMessage(data.message);
        });

        this.socket.on('player-left', (data) => {
            this.players = data.players;
            this.updatePlayersList();
            this.addSystemMessage(data.message);
        });

        this.socket.on('game-started', (data) => {
            this.currentDrawer = data.currentDrawer;
            this.isMyTurn = this.currentDrawer && this.currentDrawer.id === this.socket.id;
            this.updateGameState(data.prompt, data.round);
            this.clearCanvas();
        });

        this.socket.on('turn-changed', (data) => {
            this.currentDrawer = data.currentDrawer;
            this.isMyTurn = this.currentDrawer && this.currentDrawer.id === this.socket.id;
            this.updateGameState(data.prompt, data.round);
            this.clearCanvas();
        });

        this.socket.on('drawing-update', (data) => {
            this.handleRemoteDrawing(data);
        });

        this.socket.on('chat-message', (data) => {
            this.addChatMessage(data);
        });

        this.socket.on('correct-guess', (data) => {
            this.addCorrectGuess(data);
        });

        this.socket.on('player-voice-state', (data) => {
            this.updatePlayerVoiceState(data.playerId, data.isActive);
        });

        this.socket.on('game-error', (data) => {
            this.addSystemMessage(`Error: ${data.message}`);
        });

        // WebRTC signaling
        this.socket.on('webrtc-offer', async (data) => {
            console.log('Received offer from:', data.senderId);
            await this.handleWebRTCOffer(data);
        });

        this.socket.on('webrtc-answer', async (data) => {
            console.log('Received answer from:', data.senderId);
            await this.handleWebRTCAnswer(data);
        });

        this.socket.on('webrtc-ice-candidate', async (data) => {
            console.log('Received ICE candidate from:', data.senderId);
            await this.handleWebRTCIceCandidate(data);
        });
    }

    async createPeerConnection(peerId) {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Sending ICE candidate to:', peerId);
                this.socket.emit('webrtc-ice-candidate', {
                    targetId: peerId,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            console.log('Received remote stream from:', peerId);
            this.handleRemoteStream(peerId, event.streams[0]);
        };

        pc.onconnectionstatechange = () => {
            console.log(`Connection state with ${peerId}:`, pc.connectionState);
            const playerName = this.players.find(p => p.id === peerId)?.name || 'Unknown';
            this.addSystemMessage(`Connection to ${playerName}: ${pc.connectionState}`);
        };

        this.peerConnections.set(peerId, pc);
        return pc;
    }

    async handleWebRTCOffer(data) {
        try {
            const pc = await this.createPeerConnection(data.senderId);
            await pc.setRemoteDescription(data.offer);
            
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => {
                    pc.addTrack(track, this.audioStream);
                });
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.socket.emit('webrtc-answer', {
                targetId: data.senderId,
                answer: answer
            });
            
            console.log('Sent answer to:', data.senderId);
        } catch (error) {
            console.error('Error handling offer:', error);
            this.addSystemMessage('❌ Failed to handle voice call');
        }
    }

    async handleWebRTCAnswer(data) {
        try {
            const pc = this.peerConnections.get(data.senderId);
            if (pc) {
                await pc.setRemoteDescription(data.answer);
                console.log('Set remote description for:', data.senderId);
            }
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleWebRTCIceCandidate(data) {
        try {
            const pc = this.peerConnections.get(data.senderId);
            if (pc && pc.remoteDescription) {
                await pc.addIceCandidate(data.candidate);
                console.log('Added ICE candidate for:', data.senderId);
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    handleRemoteStream(peerId, stream) {
        const audioElements = document.getElementById('audioElements');
        let audio = document.getElementById(`audio-${peerId}`);
        
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${peerId}`;
            audio.autoplay = true;
            audio.volume = 1.0;
            audioElements.appendChild(audio);
        }
        
        audio.srcObject = stream;
        audio.muted = this.mutedPlayers.has(peerId);
        
        const playerName = this.players.find(p => p.id === peerId)?.name || 'Unknown';
        this.addSystemMessage(`🔊 Connected to ${playerName}'s audio`);
        
        // Debug: log when audio starts playing
        audio.onplaying = () => {
            this.addSystemMessage(`▶️ Playing audio from ${playerName}`);
        };
    }

    async initiateWebRTCCall(peerId) {
        try {
            const pc = await this.createPeerConnection(peerId);
            
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => {
                    pc.addTrack(track, this.audioStream);
                });
            }

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            this.socket.emit('webrtc-offer', {
                targetId: peerId,
                offer: offer
            });
            
            const playerName = this.players.find(p => p.id === peerId)?.name || 'Unknown';
            this.addSystemMessage(`📞 Calling ${playerName}...`);
        } catch (error) {
            console.error('WebRTC call error:', error);
            this.addSystemMessage('❌ Failed to initiate voice call');
        }
    }

    joinGame() {
        const nameInput = document.getElementById('playerName');
        const roomInput = document.getElementById('roomId');
        
        this.playerName = nameInput.value.trim();
        if (!this.playerName) {
            alert('Please enter your name');
            return;
        }
        
        this.roomId = roomInput.value.trim() || this.generateRoomId();
        
        this.socket.emit('join-room', {
            roomId: this.roomId,
            playerName: this.playerName
        });
    }

    generateRoomId() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    showGameScreen() {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('gameScreen').style.display = 'block';
    }

    updateRoomInfo() {
        document.getElementById('roomIdDisplay').textContent = `Room: ${this.roomId}`;
        document.getElementById('playerCount').textContent = `Players: ${this.players.length}`;
    }

    updatePlayersList() {
        const playersList = document.getElementById('playersList');
        playersList.innerHTML = '';
        
        this.players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-controls';
            playerDiv.id = `player-${player.id}`;
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'player-name';
            let displayName = player.name;
            if (player.id === this.socket.id) displayName += ' (You)';
            if (this.currentDrawer && player.id === this.currentDrawer.id) {
                displayName += ' 🎨';
                playerDiv.classList.add('drawing');
            }
            nameSpan.textContent = displayName;
            
            playerDiv.appendChild(nameSpan);
            
            // Add mute button for other players
            if (player.id !== this.socket.id) {
                const muteBtn = document.createElement('button');
                muteBtn.className = 'mute-btn';
                muteBtn.textContent = this.mutedPlayers.has(player.id) ? 'Unmute' : 'Mute';
                if (this.mutedPlayers.has(player.id)) muteBtn.classList.add('muted');
                
                muteBtn.addEventListener('click', () => this.toggleMute(player.id));
                playerDiv.appendChild(muteBtn);
            }
            
            playersList.appendChild(playerDiv);
        });
        
        this.updateRoomInfo();
    }

    toggleMute(playerId) {
        const audio = document.getElementById(`audio-${playerId}`);
        const muteBtn = document.querySelector(`#player-${playerId} .mute-btn`);
        
        if (this.mutedPlayers.has(playerId)) {
            this.mutedPlayers.delete(playerId);
            if (audio) audio.muted = false;
            muteBtn.textContent = 'Mute';
            muteBtn.classList.remove('muted');
        } else {
            this.mutedPlayers.add(playerId);
            if (audio) audio.muted = true;
            muteBtn.textContent = 'Unmute';
            muteBtn.classList.add('muted');
        }
    }

    updateGameState(prompt, round) {
        if (this.isMyTurn) {
            document.getElementById('promptTitle').textContent = 'Your turn to draw:';
            document.getElementById('drawingPrompt').textContent = prompt;
            document.getElementById('gameStatus').textContent = 'Draw the word above! Others will try to guess.';
            document.getElementById('nextTurn').style.display = 'inline-block';
            this.enableDrawing();
            this.addSystemMessage(`Your turn! Draw: "${prompt}"`);
        } else if (this.currentDrawer) {
            document.getElementById('promptTitle').textContent = `${this.currentDrawer.name} is drawing`;
            document.getElementById('drawingPrompt').textContent = 'Guess what they\'re drawing!';
            document.getElementById('gameStatus').textContent = 'Type your guess in the chat below.';
            document.getElementById('nextTurn').style.display = 'none';
            this.disableDrawing();
            this.addSystemMessage(`${this.currentDrawer.name}'s turn to draw! Try to guess what it is.`);
        }
        
        this.updatePlayersList();
    }

    enableDrawing() {
        this.canvas.classList.remove('canvas-disabled');
        document.querySelector('.tools').classList.remove('disabled');
    }

    disableDrawing() {
        this.canvas.classList.add('canvas-disabled');
        document.querySelector('.tools').classList.add('disabled');
    }

    startGame() {
        this.socket.emit('start-game');
    }

    nextTurn() {
        this.socket.emit('next-turn');
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    startDrawing(e) {
        if (!this.isMyTurn) return;
        this.isDrawing = true;
        const pos = this.getMousePos(e);
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);
        
        this.socket.emit('drawing-data', {
            type: 'start',
            x: pos.x,
            y: pos.y
        });
    }

    draw(e) {
        if (!this.isDrawing || !this.isMyTurn) return;
        const pos = this.getMousePos(e);
        this.ctx.lineTo(pos.x, pos.y);
        this.ctx.stroke();
        
        this.socket.emit('drawing-data', {
            type: 'draw',
            x: pos.x,
            y: pos.y,
            color: this.ctx.strokeStyle,
            size: this.ctx.lineWidth
        });
    }

    stopDrawing() {
        if (this.isDrawing && this.isMyTurn) {
            this.isDrawing = false;
            this.socket.emit('drawing-data', { type: 'stop' });
        }
    }

    handleRemoteDrawing(data) {
        if (data.type === 'start') {
            this.ctx.beginPath();
            this.ctx.moveTo(data.x, data.y);
        } else if (data.type === 'draw') {
            this.ctx.strokeStyle = data.color || '#000000';
            this.ctx.lineWidth = data.size || 3;
            this.ctx.lineTo(data.x, data.y);
            this.ctx.stroke();
        }
    }

    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    async toggleVoice() {
        const button = document.getElementById('voiceToggle');
        
        if (!this.voiceActive) {
            try {
                this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.voiceActive = true;
                button.textContent = '🎤 Voice On';
                button.classList.add('voice-active');
                
                this.socket.emit('voice-state', { isActive: true });
                this.addSystemMessage('Voice enabled - connecting to other players...');
                
                // Wait a bit then initiate WebRTC calls with all other players
                setTimeout(() => {
                    this.players.forEach(player => {
                        if (player.id !== this.socket.id) {
                            this.addSystemMessage(`Connecting to ${player.name}...`);
                            this.initiateWebRTCCall(player.id);
                        }
                    });
                }, 500);
                
            } catch (error) {
                this.addSystemMessage('Could not access microphone. Please check permissions.');
                console.error('Microphone error:', error);
            }
        } else {
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => track.stop());
            }
            
            // Close all peer connections
            this.peerConnections.forEach(pc => pc.close());
            this.peerConnections.clear();
            
            this.voiceActive = false;
            button.textContent = '🎤 Voice Off';
            button.classList.remove('voice-active');
            
            this.socket.emit('voice-state', { isActive: false });
            this.addSystemMessage('Voice disabled.');
        }
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        
        if (message) {
            this.socket.emit('chat-message', { message });
            input.value = '';
        }
    }

    addChatMessage(data) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        
        let messageClass = `message ${data.playerId === this.socket.id ? 'own' : 'other'}`;
        if (data.isDrawer) messageClass += ' drawer';
        
        messageDiv.className = messageClass;
        messageDiv.innerHTML = `<strong>${data.playerName}:</strong> ${data.message} <small>${data.timestamp}</small>`;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    addCorrectGuess(data) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message correct-guess';
        messageDiv.innerHTML = `<strong>${data.playerName}</strong> guessed correctly! 🎉 <small>${data.timestamp}</small>`;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        this.addSystemMessage(`${data.playerName} guessed it right!`);
    }

    updatePlayerVoiceState(playerId, isActive) {
        const playerElement = document.getElementById(`player-${playerId}`);
        if (playerElement) {
            if (isActive) {
                playerElement.classList.add('voice-active');
            } else {
                playerElement.classList.remove('voice-active');
            }
        }
    }

    async testMic() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const destination = audioContext.createMediaStreamDestination();
            source.connect(destination);
            
            const audio = new Audio();
            audio.srcObject = destination.stream;
            audio.play();
            
            this.addSystemMessage('🎧 Mic test - you should hear yourself for 3 seconds');
            
            setTimeout(() => {
                audio.pause();
                stream.getTracks().forEach(track => track.stop());
                audioContext.close();
                this.addSystemMessage('🎧 Mic test ended');
            }, 3000);
        } catch (error) {
            this.addSystemMessage('❌ Mic test failed - check permissions');
            console.error('Mic test error:', error);
        }
    }

    addSystemMessage(message) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system';
        messageDiv.textContent = `🎮 ${message}`;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        console.log('System:', message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MultiplayerGarticPhone();
});