let tg = window.Telegram.WebApp;
tg.expand();

// Читаем параметры из ссылки
const urlParams = new URLSearchParams(window.location.search);
const targetRecord = parseFloat(urlParams.get('target')); 
const duelId = urlParams.get('duel_id'); 

// Элементы интерфейса
const duelContainer = document.getElementById('duel-container');
const targetScoreDisplay = document.getElementById('target-score');

// --- НАСТРОЙКА СКИНОВ ---
let currentSkin = 'default';

// --- ЗАГРУЗКА КАРТИНОК ДЛЯ СКИНОВ ---
const skins = {
    'default': null, 
    'kazakhstan': new Image(),
    'sharingan': new Image(),
    'itachi': new Image(),
    'rinnegan': new Image()
};

// Функция упростилась: теперь просто указываем путь к файлу
function loadSkin(key, fileName) {
    skins[key].src = fileName;
}

// Теперь используем просто имена файлов, которые ты загрузил на GitHub
loadSkin('kazakhstan', 'kazakhstan.png');
loadSkin('sharingan', 'sharingan.jpg');
loadSkin('itachi', 'itachi.png');
loadSkin('rinnegan', 'rinnegan.jpg');
// ------------------------------------

if (targetRecord) {
    duelContainer.style.display = "block";
    targetScoreDisplay.innerText = targetRecord.toFixed(2);
}

const video = document.getElementById('video');
const canvas = document.getElementById('output');
const canvasCtx = canvas.getContext('2d');
const timerDisplay = document.getElementById('timer');
const actionBtn = document.getElementById('action-btn');
let currentAvgEAR = 0;
const debugDisplay = document.getElementById('debug-ear');

let isGameRunning = false;
let startTime;
let blinkThreshold = 0.25;

const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

function drawConnectors(ctx, landmarks, indices, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < indices.length; i++) {
        const index1 = indices[i];
        const index2 = indices[(i + 1) % indices.length]; 
        const point1 = landmarks[index1];
        const point2 = landmarks[index2];
        ctx.moveTo(point1.x * canvas.width, point1.y * canvas.height);
        ctx.lineTo(point2.x * canvas.width, point2.y * canvas.height);
    }
    ctx.stroke();
}

// Функция рисования скина (Заливка всего глаза)
function drawSkinFilled(ctx, landmarks, indices, img) {
    if (!img.complete || img.naturalWidth === 0) return;

    ctx.save();
    ctx.beginPath();
    
    // Рисуем контур по точкам глаза
    for (let i = 0; i < indices.length; i++) {
        const point = landmarks[indices[i]];
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip(); // Обрезаем все по форме глаза

    // Вычисляем размеры прямоугольника глаза
    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    indices.forEach(idx => {
        const p = landmarks[idx];
        minX = Math.min(minX, p.x * canvas.width);
        minY = Math.min(minY, p.y * canvas.height);
        maxX = Math.max(maxX, p.x * canvas.width);
        maxY = Math.max(maxY, p.y * canvas.height);
    });
    
    // Рисуем картинку на весь глаз
    const padding = 5;
    try {
        ctx.drawImage(img, minX - padding, minY - padding, (maxX - minX) + padding*2, (maxY - minY) + padding*2);
    } catch (e) {
        console.error(e);
    }
    ctx.restore();
}

function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function calculateEAR(landmarks, indices) {
    const v1 = getDistance(landmarks[indices[1]], landmarks[indices[5]]);
    const v2 = getDistance(landmarks[indices[2]], landmarks[indices[4]]);
    const h = getDistance(landmarks[indices[0]], landmarks[indices[3]]);
    return (v1 + v2) / (2.0 * h);
}

const faceMesh = new FaceMesh({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
}});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

faceMesh.onResults((results) => {
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return;
    const landmarks = results.multiFaceLandmarks[0];
    
    // 2. РИСУЕМ ГЛАЗА (В защищенном блоке)
    try {
        if (currentSkin === 'default') {
            const color = isGameRunning ? '#00FF00' : '#FFFFFF';
            drawConnectors(canvasCtx, landmarks, LEFT_EYE_INDICES, color);
            drawConnectors(canvasCtx, landmarks, RIGHT_EYE_INDICES, color);
        } else {
            const skinImg = skins[currentSkin];
            if (skinImg && skinImg.complete) {
                drawSkinFilled(canvasCtx, landmarks, LEFT_EYE_INDICES, skinImg);
                drawSkinFilled(canvasCtx, landmarks, RIGHT_EYE_INDICES, skinImg);
            }
        }
    } catch (error) {
        console.log("Ошибка в рисовании, но игру продолжаем!", error);
    }

    // 3. Считаем EAR
    const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES);
    const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES);
    currentAvgEAR = (leftEAR + rightEAR) / 2;

    if (debugDisplay) {
        debugDisplay.innerText = currentAvgEAR.toFixed(3);
    }

    // 4. Логика проигрыша
    if (isGameRunning) {
        if (currentAvgEAR < blinkThreshold) { 
            // Рисуем красным только если дефолт, иначе оставляем скин
            if (currentSkin === 'default') {
                drawConnectors(canvasCtx, landmarks, LEFT_EYE_INDICES, '#FF0000');
                drawConnectors(canvasCtx, landmarks, RIGHT_EYE_INDICES, '#FF0000');
            }
            endGame();
        }
    }
});

const camera = new Camera(video, {
  onFrame: async () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    await faceMesh.send({image: video});
  },
  width: 640,
  height: 480
});
camera.start();

function startGame() {
    isGameRunning = true;
    startTime = Date.now();
    
    if (currentAvgEAR <= 0) {
        blinkThreshold = 0.20;
    } else {
        blinkThreshold = currentAvgEAR * 0.8;
    }

    actionBtn.innerText = "Смотрю в оба... 👀";
    actionBtn.disabled = true;
    actionBtn.style.backgroundColor = "#ff4b4b"; 
    
    window.requestAnimationFrame(updateTimer);
}

function updateTimer() {
    if (!isGameRunning) return;
    const elapsed = (Date.now() - startTime) / 1000;
    timerDisplay.innerText = `Время: ${elapsed.toFixed(2)} сек`;

    if (targetRecord && elapsed > targetRecord) {
        timerDisplay.style.color = "#00FF00"; 
        timerDisplay.style.fontWeight = "bold";
        targetScoreDisplay.innerText = "РЕКОРД ПОБИТ! 🏆";
        targetScoreDisplay.style.color = "#00FF00";
    }
    window.requestAnimationFrame(updateTimer);
}

const resultScreen = document.getElementById('result-screen');
const resultTitle = document.getElementById('result-title');
const finalScoreDisplay = document.getElementById('final-score');
const duelResultInfo = document.getElementById('duel-result-info');
const opponentScoreDisplay = document.getElementById('opponent-score');
const submitBtn = document.getElementById('submit-btn');

let finalDataToSend = null; 

function endGame() {
    isGameRunning = false;
    const finalTime = (Date.now() - startTime) / 1000;
    let currentBest = parseFloat(localStorage.getItem('myBestScore')) || 0;
    if (finalTime > currentBest) {
        localStorage.setItem('myBestScore', finalTime);
    }
    finalDataToSend = {
        score: finalTime.toFixed(2),
        duel_id: duelId 
    };

    finalScoreDisplay.innerText = finalTime.toFixed(2);
    
    if (targetRecord) {
        duelResultInfo.style.display = "block";
        opponentScoreDisplay.innerText = targetRecord.toFixed(2);
        
        if (finalTime > targetRecord) {
            resultTitle.innerText = "ТЫ ПОБЕДИЛ! 🏆";
            resultTitle.style.color = "#00FF00"; 
            finalScoreDisplay.style.color = "#00FF00";
        } else {
            resultTitle.innerText = "ПОТРАЧЕНО 💀";
            resultTitle.style.color = "#FF0000"; 
            finalScoreDisplay.style.color = "#FF4b4b";
        }
    } else {
        duelResultInfo.style.display = "none";
        resultTitle.innerText = "ИГРА ОКОНЧЕНА";
        resultTitle.style.color = "#FFFFFF";
        finalScoreDisplay.style.color = "#ffcc00";
    }

    resultScreen.classList.add('show');
}

submitBtn.addEventListener('click', () => {
    if (finalDataToSend) {
        tg.sendData(JSON.stringify(finalDataToSend));
    } else {
        tg.close();
    }
});

// --- ЛОГИКА МЕНЮ СКИНОВ ---
const skinsBtn = document.getElementById('skins-btn');
const skinsMenu = document.getElementById('skins-menu');
const closeSkinsBtn = document.getElementById('close-skins-btn');
const skinOptions = document.querySelectorAll('.skin-option');

const savedSkin = localStorage.getItem('mySkin');
if (savedSkin) {
    currentSkin = savedSkin;
    console.log("Загружен скин:", currentSkin);
    skinOptions.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-skin') === savedSkin) {
            btn.classList.add('active');
        }
    });
}

skinsBtn.addEventListener('click', () => {
    skinsMenu.classList.add('show');
});

closeSkinsBtn.addEventListener('click', () => {
    skinsMenu.classList.remove('show');
});

skinOptions.forEach(button => {
    button.addEventListener('click', () => {
        skinOptions.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        currentSkin = button.getAttribute('data-skin');
        localStorage.setItem('mySkin', currentSkin); 
        setTimeout(() => {
            skinsMenu.classList.remove('show');
        }, 300);
    });
});

// Логика крестика (закрыть результаты без отправки)
document.getElementById('close-result-btn').addEventListener('click', () => {
    // Просто убираем класс show, скрывая окно
    document.getElementById('result-screen').classList.remove('show');
    // Можно еще сбросить текст кнопки
    actionBtn.innerText = "Начать игру";
    actionBtn.disabled = false;
    actionBtn.style.backgroundColor = "#3390ec"; // Вернуть синий цвет
});


// --- ЛОГИКА РЕЙТИНГА (С ПРОГРЕССОМ) ---
const leaderboardBtn = document.getElementById('leaderboard-btn');
const leaderboardMenu = document.getElementById('leaderboard-menu');
const closeLeaderboardBtn = document.getElementById('close-leaderboard-btn');
const leaderboardList = document.getElementById('leaderboard-list');

const fakeNames = [
    "Naruto", "Sasuke", "Terminator", "Elon Musk", 
    "Saitama", "Joker", "Batman", "NoBlink_Pro", 
    "Cat_Eye", "Dr. Strange", "Sherlock", "Targaryen"
];

// Функция для случайного числа
function randomScore(min, max) {
    return (Math.random() * (max - min) + min).toFixed(2);
}

leaderboardBtn.addEventListener('click', () => {
    leaderboardList.innerHTML = '';
    
    // 1. Берем наш рекорд
    let myBestScore = parseFloat(localStorage.getItem('myBestScore')) || 0;
    
    // 2. Генерируем "Элитный Топ-10" (у них всегда от 40 до 90 сек)
    // Это цель, к которой игрок должен стремиться
    let players = [];
    fakeNames.slice(0, 10).forEach(name => {
        players.push({ 
            name: name, 
            score: parseFloat(randomScore(40, 95)), // Сильные боты
            isMe: false 
        });
    });

    // 3. Проверяем, попал ли игрок в Топ-10?
    // Сортируем ботов, чтобы найти самого слабого из элиты (10-е место)
    players.sort((a, b) => b.score - a.score);
    let gatekeeperScore = players[9].score; // Очки 10-го места

    if (myBestScore > gatekeeperScore) {
        // СЦЕНАРИЙ А: Мы крутые! (Входим в топ-10)
        players.push({ name: "ВЫ", score: myBestScore, isMe: true });
        // Снова сортируем вместе с нами
        players.sort((a, b) => b.score - a.score);
        // Отрезаем лишнего 11-го бота, чтобы осталось 10
        players = players.slice(0, 10);
        
        // Рисуем список
        players.forEach((player, index) => {
            renderRow(index + 1, player);
        });

    } else {
        // СЦЕНАРИЙ Б: Мы еще слабы (Ниже 10-го места)
        // Рассчитываем наше фейковое место
        
        // Разница между 10-м местом и нами
        let diff = gatekeeperScore - myBestScore;
        
        // Формула: 10 + (разница * 1.5). 
        // Чем меньше разница, тем мы ближе к 10-ке.
        // Пример: Если разница 1 сек, мы на 12 месте. Если 30 сек — на 55 месте.
        let myFakeRank = 11 + Math.floor(diff * 1.5);
        
        // 1. Рисуем Топ-10 (без нас)
        players.forEach((player, index) => {
            renderRow(index + 1, player);
        });

        // 2. Рисуем разделитель "..."
        let dots = document.createElement('div');
        dots.style.textAlign = 'center';
        dots.style.color = '#888';
        dots.innerText = '...';
        leaderboardList.appendChild(dots);

        // 3. Рисуем НАС на нашем вычисленном месте
        renderRow(myFakeRank, { name: "ВЫ", score: myBestScore, isMe: true });
    }

    leaderboardMenu.classList.add('show');
});

// Вспомогательная функция для рисования строки
function renderRow(rank, player) {
    const row = document.createElement('div');
    row.className = 'leaderboard-row';
    if (player.isMe) row.classList.add('me');

    let rankIcon = rank;
    let rankClass = '';
    if (rank === 1) { rankIcon = '🥇'; rankClass = 'rank-1'; }
    else if (rank === 2) { rankIcon = '🥈'; rankClass = 'rank-2'; }
    else if (rank === 3) { rankIcon = '🥉'; rankClass = 'rank-3'; }

    row.innerHTML = `
        <span class="${rankClass}">${rankIcon}</span>
        <span style="text-align: left;">${player.name}</span>
        <span>${player.score}</span>
    `;
    leaderboardList.appendChild(row);
}

closeLeaderboardBtn.addEventListener('click', () => {
    leaderboardMenu.classList.remove('show');
});

actionBtn.addEventListener('click', startGame);