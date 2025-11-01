let mediaRecorder = null;
let monitorRecorder = null;
let isRecording = false;
let isMonitoring = false;
let recordings = [];
let emails = [];
let sensitivity = 0.75;
let audioContext = null;
let analyser = null;
let monitorStream = null;

// Inizializzazione app
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(() => logEvent('Service Worker registrato'))
        .catch(err => logEvent('Errore Service Worker: ' + err, true));
}

window.addEventListener('load', () => {
    checkPermissions();
    loadData();
});

// Gestione permessi
async function checkPermissions() {
    try {
        const micPermission = await navigator.permissions.query({ name: 'microphone' });
        if (micPermission.state !== 'granted') {
            document.getElementById('permissionBanner').style.display = 'block';
        }
    } catch (e) {
        document.getElementById('permissionBanner').style.display = 'block';
    }
}

async function requestPermissions() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        if ('Notification' in window) {
            await Notification.requestPermission();
        }
        
        document.getElementById('permissionBanner').style.display = 'none';
        updateStatus('online');
        logEvent('Permessi concessi con successo');
    } catch (err) {
        alert('Errore: permessi negati. L\'app non funzionerà correttamente.');
        logEvent('Errore permessi: ' + err.message, true);
    }
}

// Registrazione audio
async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                echoCancellation: false,
                noiseSuppression: false 
            } 
        });
        
        mediaRecorder = new MediaRecorder(stream);
        const chunks = [];
        
        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = async () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const features = await extractFeatures(blob);
            
            const recording = {
                id: Date.now(),
                name: `Campanello ${recordings.length + 1}`,
                blob: blob,
                url: URL.createObjectURL(blob),
                features: features,
                timestamp: new Date().toLocaleString('it-IT')
            };
            
            recordings.push(recording);
            saveData();
            renderRecordings();
            document.getElementById('monitorBtn').disabled = false;
            
            stream.getTracks().forEach(track => track.stop());
            logEvent(`Suono registrato: ${recording.name}`);
        };
        
        mediaRecorder.start();
        isRecording = true;
        
        const btn = document.getElementById('recordBtn');
        btn.classList.add('recording');
        btn.textContent = '⏹️ Stop Registrazione';
        
        document.getElementById('recordingStatus').textContent = 'Registrazione in corso...';
        logEvent('Registrazione avviata');
        
    } catch (err) {
        alert('Errore microfono: ' + err.message);
        logEvent('Errore registrazione: ' + err.message, true);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        isRecording = false;
        
        const btn = document.getElementById('recordBtn');
        btn.classList.remove('recording');
        btn.textContent = '🎤 Registra Campanello';
        
        document.getElementById('recordingStatus').textContent = '';
    }
}

// Monitoraggio continuo
async function toggleMonitoring() {
    if (isMonitoring) {
        stopMonitoring();
    } else {
        await startMonitoring();
    }
}

async function startMonitoring() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                echoCancellation: false,
                noiseSuppression: false 
            } 
        });
        
        monitorStream = stream;
        
        // Setup analizzatore audio per livello
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        
        updateAudioLevel();
        
        // Monitoraggio a cicli continui
        monitorRecorder = new MediaRecorder(stream);
        
        const processAudio = () => {
            const chunks = [];
            
            monitorRecorder.ondataavailable = e => {
                if (e.data.size > 0) chunks.push(e.data);
            };
            
            monitorRecorder.onstop = async () => {
                if (chunks.length === 0 || !isMonitoring) return;
                
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const features = await extractFeatures(blob);
                
                // Confronta con tutti i suoni registrati
                for (const rec of recordings) {
                    const similarity = compareSounds(features, rec.features);
                    
                    if (similarity >= sensitivity) {
                        await handleDetection(rec, similarity);
                        break;
                    }
                }
                
                // Riavvia il ciclo se ancora in monitoraggio
                if (isMonitoring && monitorRecorder) {
                    monitorRecorder.start();
                    setTimeout(() => {
                        if (monitorRecorder && monitorRecorder.state === 'recording') {
                            monitorRecorder.stop();
                        }
                    }, 2000);
                }
            };
        };
        
        processAudio();
        monitorRecorder.start();
        
        setTimeout(() => {
            if (monitorRecorder && monitorRecorder.state === 'recording') {
                monitorRecorder.stop();
            }
        }, 2000);
        
        isMonitoring = true;
        updateStatus('monitoring');
        
        const btn = document.getElementById('monitorBtn');
        btn.classList.add('active');
        btn.textContent = '⏸️ Ferma Monitoraggio';
        
        // Wake Lock per tenere attivo lo schermo
        if ('wakeLock' in navigator) {
            try {
                const wakeLock = await navigator.wakeLock.request('screen');
                logEvent('Wake Lock attivato - schermo sempre acceso');
            } catch (e) {
                logEvent('Wake Lock non disponibile', true);
            }
        }
        
        logEvent('Monitoraggio avviato - app attiva 24/7');
        
    } catch (err) {
        alert('Errore avvio monitoraggio: ' + err.message);
        logEvent('Errore monitoraggio: ' + err.message, true);
    }
}

function stopMonitoring() {
    isMonitoring = false;
    
    if (monitorRecorder) {
        if (monitorRecorder.state === 'recording') {
            monitorRecorder.stop();
        }
        monitorRecorder = null;
    }
    
    if (monitorStream) {
        monitorStream.getTracks().forEach(track => track.stop());
        monitorStream = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    updateStatus('online');
    
    const btn = document.getElementById('monitorBtn');
    btn.classList.remove('active');
    btn.textContent = '▶️ Avvia Monitoraggio';
    
    logEvent('Monitoraggio interrotto');
}

// Estrazione features audio
async function extractFeatures(blob) {
    try {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await context.decodeAudioData(arrayBuffer);
        const data = audioBuffer.getChannelData(0);
        
        // Energia RMS
        let energy = 0;
        for (let i = 0; i < data.length; i++) {
            energy += data[i] * data[i];
        }
        energy = Math.sqrt(energy / data.length);
        
        // Zero Crossing Rate
        let zcr = 0;
        for (let i = 1; i < data.length; i++) {
            if ((data[i] >= 0 && data[i-1] < 0) || (data[i] < 0 && data[i-1] >= 0)) {
                zcr++;
            }
        }
        zcr = zcr / data.length;
        
        // Picco massimo
        const peak = Math.max(...data.map(Math.abs));
        
        context.close();
        
        return { energy, zcr, peak, duration: audioBuffer.duration };
    } catch (err) {
        console.error('Errore estrazione features:', err);
        return { energy: 0, zcr: 0, peak: 0, duration: 0 };
    }
}

// Confronto somiglianza audio
function compareSounds(f1, f2) {
    const energyDiff = Math.abs(f1.energy - f2.energy) / Math.max(f1.energy, f2.energy, 0.001);
    const zcrDiff = Math.abs(f1.zcr - f2.zcr) / Math.max(f1.zcr, f2.zcr, 0.001);
    const peakDiff = Math.abs(f1.peak - f2.peak) / Math.max(f1.peak, f2.peak, 0.001);
    
    return 1 - ((energyDiff + zcrDiff + peakDiff) / 3);
}

// Gestione rilevamento
async function handleDetection(recording, similarity) {
    const message = `🔔 CAMPANELLO RILEVATO!\nSuono: ${recording.name}\nSimilarità: ${(similarity * 100).toFixed(0)}%`;
    
    logEvent(message, true);
    
    // Notifica browser
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Campanello Rilevato!', {
            body: message,
            vibrate: [200, 100, 200]
        });
    }
    
    // Invia email
    sendEmails(recording.name, similarity);
    
    // Vibrazione
    if ('vibrate' in navigator) {
        navigator.vibrate([300, 100, 300, 100, 300]);
    }
}

// Gestione email
function addEmail() {
    const input = document.getElementById('emailInput');
    const email = input.value.trim();
    
    if (email && email.includes('@') && !emails.includes(email)) {
        emails.push(email);
        input.value = '';
        saveData();
        renderEmails();
        logEvent(`Email aggiunta: ${email}`);
    } else if (emails.includes(email)) {
        alert('Questa email è già stata aggiunta!');
    } else {
        alert('Inserisci un indirizzo email valido');
    }
}

function removeEmail(email) {
    emails = emails.filter(e => e !== email);
    saveData();
    renderEmails();
    logEvent(`Email rimossa: ${email}`);
}

function sendEmails(soundName, similarity) {
    if (emails.length === 0) {
        logEvent('Nessuna email configurata', true);
        return;
    }
    
    const subject = encodeURIComponent(`🔔 ALLERTA: Campanello Rilevato`);
    const body = encodeURIComponent(
        `NOTIFICA AUTOMATICA\n\n` +
        `Suono rilevato: ${soundName}\n` +
        `Similarità: ${(similarity * 100).toFixed(1)}%\n` +
        `Data e ora: ${new Date().toLocaleString('it-IT')}\n\n` +
        `Questa è una notifica dal tuo Rilevatore Suoni 24/7.`
    );
    
    emails.forEach(email => {
        window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
    });
    
    logEvent(`Email inviate a ${emails.length} destinatari`);
}

// UI Updates
function updateStatus(status) {
    const statusEl = document.getElementById('status');
    statusEl.className = `status ${status}`;
    statusEl.textContent = status === 'online' ? 'Online' : 
                          status === 'monitoring' ? 'In Monitoraggio' : 'Offline';
}

function updateAudioLevel() {
    if (!analyser || !isMonitoring) return;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    const percentage = (average / 255) * 100;
    
    document.querySelector('.level-bar').style.width = `${percentage}%`;
    
    requestAnimationFrame(updateAudioLevel);
}

function updateSensitivity(value) {
    sensitivity = value / 100;
    document.getElementById('sensitivityValue').textContent = value;
}

function renderRecordings() {
    const list = document.getElementById('recordingsList');
    
    if (recordings.length === 0) {
        list.innerHTML = '<p class="empty-state">Nessun suono registrato</p>';
        return;
    }
    
    list.innerHTML = recordings.map(rec => `
        <div class="recording-item">
            <span>${rec.name}</span>
            <audio src="${rec.url}" controls></audio>
            <button onclick="deleteRecording(${rec.id})">🗑️</button>
        </div>
    `).join('');
}

function renderEmails() {
    const list = document.getElementById('emailList');
    
    if (emails.length === 0) {
        list.innerHTML = '<p class="empty-state">Nessuna email configurata</p>';
        return;
    }
    
    list.innerHTML = emails.map(email => `
        <div class="email-tag">
            <span>${email}</span>
            <button onclick="removeEmail('${email}')">×</button>
        </div>
    `).join('');
}

function deleteRecording(id) {
    recordings = recordings.filter(r => r.id !== id);
    saveData();
    renderRecordings();
    
    if (recordings.length === 0) {
        document.getElementById('monitorBtn').disabled = true;
    }
    
    logEvent('Registrazione eliminata');
}

function logEvent(message, isAlert = false) {
    const log = document.getElementById('eventLog');
    const entry = document.createElement('p');
    entry.className = 'log-entry' + (isAlert ? ' alert' : '');
    entry.textContent = `[${new Date().toLocaleTimeString('it-IT')}] ${message}`;
    log.insertBefore(entry, log.firstChild);
    
    // Mantieni solo ultimi 50 log
    while (log.children.length > 50) {
        log.removeChild(log.lastChild);
    }
}

function clearLog() {
    document.getElementById('eventLog').innerHTML = '<p class="log-entry">Log pulito</p>';
}

// Persistenza dati
function saveData() {
    try {
        localStorage.setItem('emails', JSON.stringify(emails));
        localStorage.setItem('recordingsCount', recordings.length);
    } catch (e) {
        logEvent('Errore salvataggio: ' + e.message, true);
    }
}

function loadData() {
    try {
        const savedEmails = localStorage.getItem('emails');
        if (savedEmails) {
            emails = JSON.parse(savedEmails);
            renderEmails();
        }
    } catch (e) {
        logEvent('Errore caricamento: ' + e.message, true);
    }
}
