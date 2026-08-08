document.addEventListener('DOMContentLoaded', () => {
    // --- Clock ---
    const timeDisplay = document.getElementById('current-time-display');
    function updateClock() {
        const now = new Date();
        timeDisplay.textContent = now.toLocaleTimeString();
    }
    setInterval(updateClock, 1000);
    updateClock();

    // --- Scratchpad Auto-save & Copy ---
    const scratchpad = document.getElementById('scratchpad-input');
    const autosaveStatus = document.getElementById('autosave-status');
    const clearBtn = document.getElementById('clear-scratchpad-btn');
    const copyBtn = document.getElementById('copy-scratchpad-btn');
    const statNotes = document.getElementById('stat-notes');

    // Load saved scratchpad
    const savedNotes = localStorage.getItem('on_the_road_notes') || '';
    scratchpad.value = savedNotes;
    updateNotesCount(savedNotes);

    scratchpad.addEventListener('input', () => {
        const text = scratchpad.value;
        localStorage.setItem('on_the_road_notes', text);
        autosaveStatus.textContent = 'Auto-saved ' + new Date().toLocaleTimeString();
        updateNotesCount(text);
    });

    function updateNotesCount(text) {
        const charLength = text.trim().length;
        const lineCount = text ? text.split('\n').length : 0;
        statNotes.textContent = `${lineCount} lines (${charLength} chars)`;
    }

    clearBtn.addEventListener('click', () => {
        if (confirm('Clear scratchpad content?')) {
            scratchpad.value = '';
            localStorage.removeItem('on_the_road_notes');
            autosaveStatus.textContent = 'Cleared';
            updateNotesCount('');
        }
    });

    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(scratchpad.value);
            const origText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            copyBtn.style.background = '#10b981';
            setTimeout(() => {
                copyBtn.textContent = origText;
                copyBtn.style.background = '';
            }, 2000);
        } catch (err) {
            alert('Failed to copy text.');
        }
    });

    // --- Route Checkpoints ---
    const checkpointForm = document.getElementById('add-checkpoint-form');
    const checkpointInput = document.getElementById('checkpoint-name-input');
    const checkpointList = document.getElementById('checkpoint-list');
    const statWaypoints = document.getElementById('stat-waypoints');

    let checkpoints = JSON.parse(localStorage.getItem('on_the_road_checkpoints')) || [
        { id: 1, text: 'Route 66 Sunset Point', completed: true },
        { id: 2, text: 'Big Sur Coastline Outlook', completed: false },
        { id: 3, text: 'Stargazing at Joshua Tree', completed: false }
    ];

    function renderCheckpoints() {
        checkpointList.innerHTML = '';
        checkpoints.forEach(item => {
            const li = document.createElement('li');
            li.className = `checkpoint-item ${item.completed ? 'completed' : ''}`;
            
            const textSpan = document.createElement('span');
            textSpan.textContent = item.text;
            textSpan.style.cursor = 'pointer';
            textSpan.addEventListener('click', () => toggleCheckpoint(item.id));

            const delBtn = document.createElement('button');
            delBtn.className = 'delete-btn';
            delBtn.innerHTML = '✕';
            delBtn.title = 'Remove Stop';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteCheckpoint(item.id);
            });

            li.appendChild(textSpan);
            li.appendChild(delBtn);
            checkpointList.appendChild(li);
        });

        localStorage.setItem('on_the_road_checkpoints', JSON.stringify(checkpoints));
        const doneCount = checkpoints.filter(c => c.completed).length;
        statWaypoints.textContent = `${doneCount}/${checkpoints.length} Completed`;
    }

    function toggleCheckpoint(id) {
        checkpoints = checkpoints.map(c => c.id === id ? { ...c, completed: !c.completed } : c);
        renderCheckpoints();
    }

    function deleteCheckpoint(id) {
        checkpoints = checkpoints.filter(c => c.id !== id);
        renderCheckpoints();
    }

    checkpointForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = checkpointInput.value.trim();
        if (val) {
            checkpoints.push({
                id: Date.now(),
                text: val,
                completed: false
            });
            checkpointInput.value = '';
            renderCheckpoints();
        }
    });

    renderCheckpoints();

    // --- Web Audio Ambient Synthesizer ---
    let audioCtx = null;
    let currentSoundSource = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function stopSound() {
        if (currentSoundSource) {
            currentSoundSource.stop();
            currentSoundSource.disconnect();
            currentSoundSource = null;
        }
    }

    const rainBtn = document.getElementById('vibe-rain-btn');
    const lofiBtn = document.getElementById('vibe-lofi-btn');

    let activeSound = null;

    rainBtn.addEventListener('click', () => {
        initAudio();
        if (activeSound === 'rain') {
            stopSound();
            activeSound = null;
            rainBtn.classList.remove('active');
            return;
        }
        stopSound();
        activeSound = 'rain';
        rainBtn.classList.add('active');
        lofiBtn.classList.remove('active');

        // Pink noise generator for highway rain
        const bufferSize = audioCtx.sampleRate * 2;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
            let white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            data[i] *= 0.04;
            b6 = white * 0.115926;
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, audioCtx.currentTime);

        noise.connect(filter);
        filter.connect(audioCtx.destination);
        noise.start();
        currentSoundSource = noise;
    });

    lofiBtn.addEventListener('click', () => {
        initAudio();
        if (activeSound === 'lofi') {
            stopSound();
            activeSound = null;
            lofiBtn.classList.remove('active');
            return;
        }
        stopSound();
        activeSound = 'lofi';
        lofiBtn.classList.add('active');
        rainBtn.classList.remove('active');

        // Warm drone oscillator for synth vibe
        const osc = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, audioCtx.currentTime); // A2 chord
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(164.81, audioCtx.currentTime); // E3 chord

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, audioCtx.currentTime);

        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);

        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc2.start();

        currentSoundSource = {
            stop: () => {
                osc.stop();
                osc2.stop();
            },
            disconnect: () => {
                gain.disconnect();
            }
        };
    });

    // --- Dynamic Theme Shifter ---
    const themeBtn = document.getElementById('random-theme-btn');
    const themes = [
        { main: '#ff7b00', sec: '#8a2be2', cyan: '#00f0ff' },
        { main: '#00f0ff', sec: '#3b82f6', cyan: '#10b981' },
        { main: '#ff007f', sec: '#7928ca', cyan: '#ffb703' },
        { main: '#10b981', sec: '#059669', cyan: '#38bdf8' }
    ];
    let themeIndex = 0;

    themeBtn.addEventListener('click', () => {
        themeIndex = (themeIndex + 1) % themes.length;
        const t = themes[themeIndex];
        document.documentElement.style.setProperty('--accent-orange', t.main);
        document.documentElement.style.setProperty('--accent-purple', t.sec);
        document.documentElement.style.setProperty('--accent-cyan', t.cyan);
    });
});
