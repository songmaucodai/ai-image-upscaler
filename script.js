// --- 1. THEME LOGIC ---
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    html.classList.add('dark');
} else {
    html.classList.remove('dark');
}

themeToggle.addEventListener('click', () => {
    html.classList.toggle('dark');
    localStorage.theme = html.classList.contains('dark') ? 'dark' : 'light';
});

// --- 2. DRAG & DROP & FILE HANDLING ---
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const startBtn = document.getElementById('startBtn');
let selectedFiles = [];

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-active');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-active'));

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-active');
    handleFiles(e.dataTransfer.files);
});

function handleFiles(files) {
    if (files.length > 50) {
        alert("Vui lòng chỉ chọn tối đa 50 ảnh để đảm bảo hiệu năng!");
        return;
    }
    selectedFiles = Array.from(files);
    if (selectedFiles.length > 0) {
        startBtn.disabled = false;
        startBtn.querySelector('span').innerText = `Bắt đầu xử lý (${selectedFiles.length} ảnh)`;
        document.getElementById('progressSection').classList.add('hidden');
        document.getElementById('resultArea').classList.add('hidden');
        document.getElementById('resultArea').innerHTML = '';
    }
}

// --- 3. UPSCALING LOGIC ---
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const percentText = document.getElementById('percentText');
const statusLog = document.getElementById('statusLog');
const resultArea = document.getElementById('resultArea');

let upscaler;
let zip;

async function processImages() {
    if (selectedFiles.length === 0) return;

    // Reset UI
    startBtn.disabled = true;
    progressSection.classList.remove('hidden');
    resultArea.classList.remove('hidden');
    resultArea.innerHTML = '';
    
    // Đặt bộ đếm về 0 ngay từ đầu
    const totalFiles = selectedFiles.length;
    updateProgress(0, totalFiles, 0, "Đang tải Model AI...");

    const scaleOption = document.getElementById('scaleSelect').value;
    const formatOption = document.getElementById('formatSelect').value; // png hoặc jpg
    const useZip = document.getElementById('zipCheck').checked;

    if (useZip) zip = new JSZip();

    try {
    // Init Model
    if (!upscaler) {
        const model =
            (window['@upscalerjs/esrgan-slim'] && (window['@upscalerjs/esrgan-slim'].default || window['@upscalerjs/esrgan-slim'])) ||
            (window.esrganSlim && (window.esrganSlim.default || window.esrganSlim));

        if (!model) {
            throw new Error("Không tìm thấy model '@upscalerjs/esrgan-slim' (script CDN có thể chưa load hoặc bị chặn).");
        }

        upscaler = new Upscaler({ model });

        // Warmup đúng cách: dùng canvas nhỏ (bitmap source hợp lệ), tránh <img> rỗng
        const warmCanvas = document.createElement('canvas');
        warmCanvas.width = 2;
        warmCanvas.height = 2;
        const warmCtx = warmCanvas.getContext('2d');
        warmCtx.fillRect(0, 0, 2, 2);

        await upscaler.upscale(warmCanvas);
    }
} catch (e) {
    console.error(e);
    const msg = e && e.message ? e.message : String(e);
    alert("Lỗi tải Model AI: " + msg);
    statusLog.innerText = "Lỗi tải Model AI: " + msg;
    startBtn.disabled = false;
    return;
}

    // Vòng lặp xử lý từng ảnh
    for (let i = 0; i < totalFiles; i++) {
        const file = selectedFiles[i];
        
        // Cập nhật log đang chạy (số lượng hoàn thành vẫn giữ nguyên)
        statusLog.innerText = `Đang xử lý: ${file.name} ...`;

        try {
            const imgUrl = URL.createObjectURL(file);
            const img = new Image();
            img.src = imgUrl;
            await img.decode();

            let resultSrc;

            // Logic Upscale
            const options = { patchSize: 64, padding: 2 };
            if (scaleOption == "8") {
                // 8x cần chạy 2 lần 4x
                const pass1 = await upscaler.upscale(img, options);
                const imgPass2 = new Image();
                imgPass2.src = pass1;
                await imgPass2.decode();
                resultSrc = await upscaler.upscale(imgPass2, options);
            } else if (scaleOption == "2") {
                resultSrc = await upscaler.upscale(img, { patchSize: 128, padding: 2 });
            } else {
                // 4x Default
                resultSrc = await upscaler.upscale(img, options);
            }

            // Chuyển đổi định dạng nếu cần (Mặc định AI trả về PNG)
            let finalSrc = resultSrc;
            let fileExt = "png";
            
            if (formatOption === 'jpg') {
                finalSrc = await convertImageFormat(resultSrc, 'image/jpeg');
                fileExt = "jpg";
            }

            const fileNameWithoutExt = file.name.split('.').slice(0, -1).join('.');
            const newFileName = `upscaled_${fileNameWithoutExt}.${fileExt}`;

            // Thêm vào giao diện
            addResultThumbnail(finalSrc, newFileName);

            // Thêm vào Zip
            if (useZip) {
                const base64Data = finalSrc.split(',')[1];
                zip.file(newFileName, base64Data, {base64: true});
            }

            URL.revokeObjectURL(imgUrl);

            // Xử lý xong 1 ảnh -> Tăng bộ đếm
            const completedCount = i + 1;
            const percent = Math.round((completedCount / totalFiles) * 100);
            updateProgress(completedCount, totalFiles, percent, null);

        } catch (err) {
            console.error(err);
            statusLog.innerText = `Lỗi file ${file.name}: ${err.message}`;
        }
    }

    // Hoàn tất
    statusLog.innerText = "Đã hoàn thành tất cả!";
    
    if (useZip) {
        statusLog.innerText = "Đang nén file Zip...";
        zip.generateAsync({type:"blob"}).then(function(content) {
            saveAs(content, "upscaled_images.zip");
            statusLog.innerText = "Đã tải xuống file Zip!";
        });
    }

    startBtn.disabled = false;
    startBtn.querySelector('span').innerText = "Hoàn thành - Chọn ảnh mới";
    selectedFiles = [];
}

// Hàm cập nhật bộ đếm & thanh tiến trình
function updateProgress(doneCount, total, percent, status) {
    // Hiển thị dạng: Hoàn thành: 1 / 38
    progressText.innerText = `Hoàn thành: ${doneCount} / ${total}`;
    percentText.innerText = `${percent}%`;
    progressBar.style.width = `${percent}%`;
    if(status) statusLog.innerText = status;
}

// Hàm chuyển đổi format ảnh (PNG -> JPG)
function convertImageFormat(src, mimeType) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            
            // Nếu là JPG, vẽ nền trắng (vì JPG không hỗ trợ trong suốt)
            if (mimeType === 'image/jpeg') {
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL(mimeType, 0.9)); // Chất lượng 0.9
        };
        img.src = src;
    });
}

function addResultThumbnail(src, name) {
    const div = document.createElement('div');
    div.className = "bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden aspect-square relative group border border-gray-200 dark:border-gray-600 shadow-sm transition-transform hover:scale-[1.02]";
    div.innerHTML = `
        <img src="${src}" class="w-full h-full object-cover">
        <a href="${src}" download="${name}" class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition duration-200 cursor-pointer">
            <svg class="w-8 h-8 text-white mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            <span class="text-white text-[10px] px-2 text-center truncate w-full">${name}</span>
        </a>
    `;
    resultArea.appendChild(div);
}

// --- AUTO YEAR LOGIC ---
const yearText = document.getElementById('yearText');
const startYear = 2026;
const currentYear = new Date().getFullYear();

if (currentYear > startYear) {
    yearText.innerText = `${startYear} - ${currentYear}`;
} else {
    yearText.innerText = startYear;
}
