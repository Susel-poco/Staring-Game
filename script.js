let tg = window.Telegram.WebApp;
tg.expand();

// Читаем параметры из ссылки
const urlParams = new URLSearchParams(window.location.search);
const targetRecord = parseFloat(urlParams.get('target')); 
const duelId = urlParams.get('duel_id'); // <--- Читаем ID дуэли из ссылки

// Элементы интерфейса дуэли
const duelContainer = document.getElementById('duel-container');
const targetScoreDisplay = document.getElementById('target-score');

// --- НАСТРОЙКА СКИНОВ ---
let currentSkin = 'default'; // Какой скин выбран сейчас

// Загружаем изображение флага (оно должно быть готово до начала рисования)
const kazFlagImg = new Image();
// Используем надежную ссылку на Википедию (или можешь скачать файл к себе в папку site)
kazFlagImg.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Flag_of_Kazakhstan.svg/640px-Flag_of_Kazakhstan.svg.png';
// ------------------------

// Если рекорд есть (значит, мы пришли по ссылке друга)
if (targetRecord) {
    duelContainer.style.display = "block"; // Показываем плашку
    targetScoreDisplay.innerText = targetRecord.toFixed(2);
}
const video = document.getElementById('video');
const canvas = document.getElementById('output');
const canvasCtx = canvas.getContext('2d'); // Получаем "кисть" для рисования
const timerDisplay = document.getElementById('timer');
const actionBtn = document.getElementById('action-btn');
let currentAvgEAR = 0; // Сюда будем писать текущее состояние глаз
const debugDisplay = document.getElementById('debug-ear'); // Наш новый элемент отладки

let isGameRunning = false;
let startTime;
let blinkThreshold = 0.25; // Порог моргания для EAR (настраиваемый)

// --- НАСТРОЙКА РИСОВАНИЯ ---
// Индексы точек вокруг глаз (стандарт MediaPipe)
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

// Функция для рисования соединений между точками
function drawConnectors(ctx, landmarks, indices, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    // Проходим по индексам и соединяем их линиями
    for (let i = 0; i < indices.length; i++) {
        const index1 = indices[i];
        // Соединяем последнюю точку с первой, чтобы замкнуть круг
        const index2 = indices[(i + 1) % indices.length]; 
        
        const point1 = landmarks[index1];
        const point2 = landmarks[index2];

        // Координаты в MediaPipe нормализованы (от 0 до 1),
        // поэтому умножаем на ширину/высоту холста
        ctx.moveTo(point1.x * canvas.width, point1.y * canvas.height);
        ctx.lineTo(point2.x * canvas.width, point2.y * canvas.height);
    }
    ctx.stroke();
}
// ---------------------------
// Функция для заливки области глаза изображением (Скин)
function drawSkinFilled(ctx, landmarks, indices, img) {
    // Если картинка еще не загрузилась, не рисуем
    if (!img.complete) return;

    ctx.save(); // 1. Сохраняем текущее состояние канваса

    ctx.beginPath();
    // 2. Создаем путь (контур) по точкам глаза
    for (let i = 0; i < indices.length; i++) {
        const point = landmarks[indices[i]];
        // Нормализуем координаты
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    
    // 3. ВАЖНО: Обрезаем всё, что будет нарисовано дальше, по этому контуру
    ctx.clip(); 

    // 4. Вычисляем границы глаза, чтобы знать, куда вписать флаг
    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    indices.forEach(idx => {
        const p = landmarks[idx];
        minX = Math.min(minX, p.x * canvas.width);
        minY = Math.min(minY, p.y * canvas.height);
        maxX = Math.max(maxX, p.x * canvas.width);
        maxY = Math.max(maxY, p.y * canvas.height);
    });
    
    // Добавляем небольшой отступ (padding), чтобы флаг покрыл линии
    const padding = 5;
    // 5. Рисуем изображение флага в прямоугольнике, охватывающем глаз
    // Благодаря ctx.clip(), оно покажется только внутри формы глаза
    ctx.drawImage(img, minX - padding, minY - padding, (maxX - minX) + padding*2, (maxY - minY) + padding*2);

    ctx.restore(); // 6. Восстанавливаем канвас (убираем обрезку для следующих элементов)
}
// --- МАТЕМАТИКА МОРГАНИЯ (EAR) ---
// Функция вычисления расстояния между двумя точками
function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Функция вычисления коэффициента открытости глаза (Eye Aspect Ratio)
function calculateEAR(landmarks, indices) {
    // Вертикальные расстояния
    const v1 = getDistance(landmarks[indices[1]], landmarks[indices[5]]);
    const v2 = getDistance(landmarks[indices[2]], landmarks[indices[4]]);
    // Горизонтальное расстояние
    const h = getDistance(landmarks[indices[0]], landmarks[indices[3]]);
    
    // Формула EAR
    return (v1 + v2) / (2.0 * h);
}
// --------------------------------

// Настройка нейросети
const faceMesh = new FaceMesh({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
}});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

// ОСНОВНОЙ ЦИКЛ ОБРАБОТКИ КАДРА
faceMesh.onResults((results) => {
    // 1. Очищаем холст
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return;
    const landmarks = results.multiFaceLandmarks[0];
    
    // 2. Рисуем скин в зависимости от выбора
    if (currentSkin === 'default') {
    // Старая добрая обводка
        const color = isGameRunning ? '#00FF00' : '#FFFFFF';
        drawConnectors(canvasCtx, landmarks, LEFT_EYE_INDICES, color);
        drawConnectors(canvasCtx, landmarks, RIGHT_EYE_INDICES, color);
    } else if (currentSkin === 'kazakhstan') {
    // Новый крутой флаг
        drawSkinFilled(canvasCtx, landmarks, LEFT_EYE_INDICES, kazFlagImg);
        drawSkinFilled(canvasCtx, landmarks, RIGHT_EYE_INDICES, kazFlagImg);
}

    // 3. Считаем EAR (Коэффициент)
    const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES);
    const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES);
    
    // ВАЖНОЕ ИЗМЕНЕНИЕ ТУТ:
    // Мы не пишем 'const avgEAR = ...', мы пишем в глобальную переменную без 'const'
    currentAvgEAR = (leftEAR + rightEAR) / 2;

    // Выводим цифры на экран (чтобы ты видел, как оно меняется)
    if (debugDisplay) {
        debugDisplay.innerText = currentAvgEAR.toFixed(3);
    }

    // 4. Логика проигрыша (работает только если нажата кнопка Старт)
    if (isGameRunning) {
        // Сравниваем текущее значение с порогом, который мы вычислили при старте
        if (currentAvgEAR < blinkThreshold) { 
            // Если моргнул:
            drawConnectors(canvasCtx, landmarks, LEFT_EYE_INDICES, '#FF0000'); // Красные глаза
            drawConnectors(canvasCtx, landmarks, RIGHT_EYE_INDICES, '#FF0000');
            endGame();
        }
    }
});

// Запуск камеры и синхронизация размеров холста
const camera = new Camera(video, {
  onFrame: async () => {
    // Важно: размеры холста должны совпадать с видео
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    await faceMesh.send({image: video});
  },
  width: 640,
  height: 480
});
camera.start();

// --- ЛОГИКА ИГРЫ (Таймер и кнопки) ---
function startGame() {
    console.log("Кнопка нажата!"); // Увидим в консоли
    console.log("Текущий EAR:", currentAvgEAR);

    // ВРЕМЕННО: Убираем защиту полностью, чтобы проверить запуск
    // if (currentAvgEAR === 0) { ... } <--- МЫ ЭТО УДАЛИЛИ

    isGameRunning = true;
    startTime = Date.now();
    
    // Если глаза не найдены (0), ставим принудительно 0.20, чтобы игра началась
    if (currentAvgEAR <= 0) {
        blinkThreshold = 0.20;
        alert("Внимание: Глаза не найдены, использую стандартный порог!");
    } else {
        blinkThreshold = currentAvgEAR * 0.8;
    }

    actionBtn.innerText = "Смотрю в оба... 👀";
    actionBtn.disabled = true;
    actionBtn.style.backgroundColor = "#ff4b4b"; 
    
    // Запускаем таймер
    window.requestAnimationFrame(updateTimer);
}

function updateTimer() {
    if (!isGameRunning) return;
    
    const elapsed = (Date.now() - startTime) / 1000;
    timerDisplay.innerText = `Время: ${elapsed.toFixed(2)} сек`;

    // --- ЛОГИКА ДУЭЛИ ---
    // Если это дуэль И мы только что побили рекорд
    if (targetRecord && elapsed > targetRecord) {
        // Красим таймер в зеленый цвет победы!
        timerDisplay.style.color = "#00FF00"; 
        timerDisplay.style.fontWeight = "bold";
        
        // Меняем надпись цели
        targetScoreDisplay.innerText = "РЕКОРД ПОБИТ! 🏆";
        targetScoreDisplay.style.color = "#00FF00";
    }
    // --------------------

    window.requestAnimationFrame(updateTimer);
}

// Элементы экрана результатов
const resultScreen = document.getElementById('result-screen');
const resultTitle = document.getElementById('result-title');
const finalScoreDisplay = document.getElementById('final-score');
const duelResultInfo = document.getElementById('duel-result-info');
const opponentScoreDisplay = document.getElementById('opponent-score');
const submitBtn = document.getElementById('submit-btn');

let finalDataToSend = null; // Здесь будем хранить данные, пока юзер не нажмет кнопку

function endGame() {
    isGameRunning = false;
    const finalTime = (Date.now() - startTime) / 1000;
    
    // 1. Готовим данные для отправки (но пока не отправляем!)
    finalDataToSend = {
        score: finalTime.toFixed(2),
        duel_id: duelId // ID дуэли, если он есть
    };

    // 2. Заполняем экран результатами
    finalScoreDisplay.innerText = finalTime.toFixed(2);
    
    // 3. Логика отображения (Одиночная игра или Дуэль?)
    if (targetRecord) {
        // --- ЭТО ДУЭЛЬ ---
        duelResultInfo.style.display = "block";
        opponentScoreDisplay.innerText = targetRecord.toFixed(2);
        
        // Проверяем, кто победил
        if (finalTime > targetRecord) {
            // ПОБЕДА
            resultTitle.innerText = "ТЫ ПОБЕДИЛ! 🏆";
            resultTitle.style.color = "#00FF00"; // Зеленый
            finalScoreDisplay.style.color = "#00FF00";
        } else {
            // ПОРАЖЕНИЕ
            resultTitle.innerText = "ПОТРАЧЕНО 💀";
            resultTitle.style.color = "#FF0000"; // Красный
            finalScoreDisplay.style.color = "#FF4b4b";
        }
    } else {
        // --- ЭТО ОДИНОЧНАЯ ИГРА ---
        duelResultInfo.style.display = "none";
        resultTitle.innerText = "ИГРА ОКОНЧЕНА";
        resultTitle.style.color = "#FFFFFF";
        finalScoreDisplay.style.color = "#ffcc00";
    }

    // 4. Показываем экран (добавляем класс show)
    resultScreen.classList.add('show');
}

// 5. Обработка нажатия на кнопку "Отправить результат"
submitBtn.addEventListener('click', () => {
    // Вот теперь реально отправляем данные боту и закрываемся
    if (finalDataToSend) {
        tg.sendData(JSON.stringify(finalDataToSend));
    } else {
        tg.close(); // На всякий случай
    }
});
// --- ЛОГИКА МЕНЮ СКИНОВ ---
const skinsBtn = document.getElementById('skins-btn');
const skinsMenu = document.getElementById('skins-menu');
const closeSkinsBtn = document.getElementById('close-skins-btn');
const skinOptions = document.querySelectorAll('.skin-option');

// 1. ПРОВЕРКА ПРИ ЗАПУСКЕ: Есть ли сохраненный скин?
const savedSkin = localStorage.getItem('mySkin'); // Читаем память браузера
if (savedSkin) {
    currentSkin = savedSkin; // Применяем скин
    console.log("Загружен скин:", currentSkin);

    // Визуально обновляем меню (переставляем зеленую рамку)
    skinOptions.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-skin') === savedSkin) {
            btn.classList.add('active');
        }
    });
}

// Открыть меню
skinsBtn.addEventListener('click', () => {
    skinsMenu.classList.add('show');
});

// Закрыть меню
closeSkinsBtn.addEventListener('click', () => {
    skinsMenu.classList.remove('show');
});

// Выбор скина
skinOptions.forEach(button => {
    button.addEventListener('click', () => {
        // Убираем подсветку со всех
        skinOptions.forEach(btn => btn.classList.remove('active'));
        // Добавляем нажатой
        button.classList.add('active');
        
        // Меняем переменную
        currentSkin = button.getAttribute('data-skin');
        
        // !!! СОХРАНЯЕМ В ПАМЯТЬ !!!
        localStorage.setItem('mySkin', currentSkin); 
        
        console.log("Скин сохранен:", currentSkin);
        
        // Закрываем меню
        setTimeout(() => {
            skinsMenu.classList.remove('show');
        }, 300);
    });
});


actionBtn.addEventListener('click', startGame);