const firebaseConfig = {
  apiKey: "AIzaSyALry366Yejb8wV3DLsrK8Wy4EV85sLyBU",
  authDomain: "staring-game.firebaseapp.com",
  projectId: "staring-game",
  storageBucket: "staring-game.firebasestorage.app",
  messagingSenderId: "912261406650",
  appId: "1:912261406650:web:4f04076cd53d22e463c783"
};

let bannedWords = [];

// Загружаем твой файл profanity-list.json
fetch('profanity-list.json')
    .then(response => response.json())
    .then(data => {
        // Выбираем только русский список слов из объекта
        bannedWords = data.ru; 
        console.log("База плохих слов (RU) загружена. Всего слов: " + bannedWords.length);
    })
    .catch(err => console.error("Ошибка загрузки цензора:", err));

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

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
    'russia': new Image(),
    'rinnegan': new Image(),
    'kyrgyzstan': new Image(),
    'heisenberg': new Image(),
    'saul': new Image()

};

loadSkin('heisenberg', 'heisenberg.png');
loadSkin('saul', 'saul_goodman.png');

// Функция упростилась: теперь просто указываем путь к файлу
function loadSkin(key, fileName) {
    skins[key].src = fileName;
}

// Теперь используем просто имена файлов, которые ты загрузил на GitHub
loadSkin('kazakhstan', 'kazakhstan.png');
loadSkin('sharingan', 'sharingan.jpg');
loadSkin('russia', 'russia.jpg');
loadSkin('rinnegan', 'rinnegan.jpg');
loadSkin('kyrgyzstan', 'kyrgyzstan.jpeg');
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
            const color = isGameRunning ? '#31e52e' : '#FFFFFF';
            drawConnectors(canvasCtx, landmarks, LEFT_EYE_INDICES, color);
            drawConnectors(canvasCtx, landmarks, RIGHT_EYE_INDICES, color);
        } 
        // --- НОВАЯ ЛОГИКА ДЛЯ ПОЛНОЙ МАСКИ (Хайзенберг) ---
        else if (currentSkin === 'heisenberg' || currentSkin === 'saul') {
            const skinImg = skins[currentSkin];
            if (skinImg && skinImg.complete) {
                // Точки привязки остаются те же
                const top = landmarks[10];
                const bottom = landmarks[152];
                const left = landmarks[234];
                const right = landmarks[454];

                // Ширина и высота самого лица игрока
                const faceWidth = Math.abs(right.x - left.x) * canvas.width;
                const faceHeight = Math.abs(bottom.y - top.y) * canvas.height;

                // Центр маски — точка между глаз (168)
                const centerX = landmarks[168].x * canvas.width;
                const centerY = landmarks[168].y * canvas.height;

                // --- ⚙️ НАСТРОЙКИ РАЗМЕРА И ПОЗИЦИИ ⚙️ ---

                // 1. УМЕНЬШАЕМ РАЗМЕР (был 1.8, делаем меньше)
                // Если маска всё ещё большая, сделай число ещё меньше (например, 1.45)
                const scale = 1.57; 
                const maskW = faceWidth * scale;
                const maskH = maskW * (skinImg.height / skinImg.width);

                // 2. ПОДНИМАЕМ ВВЕРХ
                // Мы вычисляем смещение вверх как процент от высоты лица (faceHeight).
                // 0.2 — это 20% высоты лица. Если маска низко, увеличивай это число (0.25, 0.3...)
                // Если маска слишком высоко улетела, уменьшай число (0.15, 0.1...)
                const verticalOffset = faceHeight * 0.14; 

                // --- 🖌️ ОТРИСОВКА 🖌️ ---
                canvasCtx.save();
                
                // Зеркальное отображение (Mirror) уже учтено в CSS, рисуем прямо
                canvasCtx.drawImage(
                    skinImg, 
                    centerX - maskW / 2, // Горизонтально — по центру
                    
                    // 👇 ВОТ ЗДЕСЬ МЫ ПОДНИМАЕМ МАСКУ 👇
                    // (ЦентрY - половина маски) - СмещениеВверх
                    (centerY - maskH / 2) - verticalOffset, 
                    
                    maskW, 
                    maskH
                );
                canvasCtx.restore();
            }
}
        // Старая логика для обычных глазных скинов
        else {
            const skinImg = skins[currentSkin];
            if (skinImg && skinImg.complete) {
                drawSkinFilled(canvasCtx, landmarks, LEFT_EYE_INDICES, skinImg);
                drawSkinFilled(canvasCtx, landmarks, RIGHT_EYE_INDICES, skinImg);
            }
        }
    } catch (error) {
        console.log("Ошибка отрисовки маски:", error);
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

// --- ЛОГИКА ОТОБРАЖЕНИЯ И ИЗМЕНЕНИЯ НИКА ---
const currentNickDisplay = document.getElementById('current-nickname');
const changeNickBtn = document.getElementById('change-nick-btn');

function isNickClean(name) {
    if (bannedWords.length === 0) return true; // Если база еще грузится, разрешаем
    
    const lowerName = name.toLowerCase();
    
    // Проверяем, содержится ли какое-то плохое слово в нике
    // Метод .some вернет true, если найдет хотя бы одно совпадение
    const hasBadWord = bannedWords.some(word => {
        // Мы ищем слово только если оно длиннее 2 символов, чтобы не банить за случайные слоги
        if (word.length <= 2) return false;
        return lowerName.includes(word.toLowerCase());
    });

    return !hasBadWord;
}

function updateNickDisplay() {
    let nick = localStorage.getItem('playerNick');
    if (!nick) {
        nick = "Аноним";
    }
    if (currentNickDisplay) {
        currentNickDisplay.innerText = nick;
    }
}

updateNickDisplay();

// --- ЛОГИКА ОТОБРАЖЕНИЯ И ИЗМЕНЕНИЯ НИКА ---
const MAX_NICK_LENGTH = 12; // Наш лимит

if (changeNickBtn) {
    changeNickBtn.addEventListener('click', () => {
        let oldNick = localStorage.getItem('playerNick') || "Игрок";
        let newNick = prompt(`Введите новый никнейм (макс. ${MAX_NICK_LENGTH} симв.):`, oldNick);
        
        if (newNick !== null && newNick.trim() !== "") {
            // Обрезаем ник, если он длиннее лимита
            let cleanNick = newNick.trim().substring(0, MAX_NICK_LENGTH); 
            
            if (isNickClean(cleanNick)) {
                localStorage.setItem('playerNick', cleanNick);
                updateNickDisplay();
            } else {
                alert("⚠️ Ник содержит запрещенные слова!");
            }
        }
    });
}

function startGame() {
    isGameRunning = true;
    startTime = Date.now();
    
    // Настраиваем чувствительность под глаза игрока
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
    const playerName = localStorage.getItem('playerNick') || "Аноним";

    if (isNickClean(playerName)) {
        // 1. Ищем, есть ли уже игрок с таким именем в Firebase
        db.collection("leaderboard")
            .where("name", "==", playerName)
            .get()
            .then((querySnapshot) => {
                if (!querySnapshot.empty) {
                    // Игрок найден — берем его первый (и единственный) документ
                    const doc = querySnapshot.docs[0];
                    const existingData = doc.data();

                    // 2. Обновляем, только если новый результат выше старого
                    if (finalTime > existingData.score) {
                        doc.ref.update({
                            score: finalTime,
                            timestamp: firebase.firestore.FieldValue.serverTimestamp()
                        }).then(() => console.log("Рекорд обновлен! 🚀"));
                    } else {
                        console.log("Новый результат не побил старый рекорд.");
                    }
                } else {
                    // 3. Такого игрока еще нет — создаем новую запись
                    db.collection("leaderboard").add({
                        name: playerName,
                        score: finalTime,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    }).then(() => console.log("Новый игрок добавлен в базу!"));
                }
            })
            .catch((error) => console.error("Ошибка Firebase: ", error));
    }

    finalScoreDisplay.innerText = finalTime.toFixed(2);
    resultScreen.classList.add('show');
}

submitBtn.addEventListener('click', () => {
    // Просто закрываем экран результатов, чтобы игрок мог начать заново
    resultScreen.classList.remove('show');
    actionBtn.innerText = "Начать игру";
    actionBtn.disabled = false;

    actionBtn.style.backgroundColor = "";
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
    const myName = localStorage.getItem('playerNick') || "Аноним";
    leaderboardList.innerHTML = '<div style="text-align:center; padding: 20px;">Загрузка данных... ⏳</div>';
    leaderboardMenu.classList.add('show');
    
    // Запрашиваем топ-10 игроков
    db.collection("leaderboard")
      .orderBy("score", "desc")
      .limit(10)
      .get()
      .then((querySnapshot) => {
          leaderboardList.innerHTML = ''; 
          let rank = 1;
          
          const myName = localStorage.getItem('playerNick') || "Аноним";

          querySnapshot.forEach((doc) => {
              const data = doc.data();
              // Проверяем, это наш результат или чужой
              const isMe = data.name === myName;
              
              renderRow(rank, { 
                  name: data.name, 
                  score: data.score.toFixed(2), 
                  isMe: isMe 
              });
              rank++;
          });
          
          if (querySnapshot.empty) {
              leaderboardList.innerHTML = '<div style="text-align:center;">Пока нет рекордов. Будь первым!</div>';
          }
      })
      .catch((error) => {
          console.error("Ошибка загрузки рейтинга:", error);
          leaderboardList.innerHTML = '<div style="text-align:center; color: red;">Ошибка сети 🌐</div>';
      });
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

// --- СЧЕТЧИК FPS ---
const fpsDisplay = document.getElementById('fps-counter');
let lastFrameTime = performance.now();
let frameCount = 0;

function calculateFPS() {
    const now = performance.now();
    frameCount++;
    if (now - lastFrameTime >= 1000) { // Обновляем раз в секунду
        fpsDisplay.innerText = frameCount;
        frameCount = 0;
        lastFrameTime = now;
    }
    requestAnimationFrame(calculateFPS);
}
calculateFPS();

closeLeaderboardBtn.addEventListener('click', () => {
    leaderboardMenu.classList.remove('show');
});

actionBtn.addEventListener('click', startGame);