// --- 1. THEME LOGIC ---
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

// Check LocalStorage & System Preference
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
        // Reset UI
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

    startBtn.disabled = true;
    progressSection.classList.remove('hidden');
    resultArea.classList.remove('hidden');
    resultArea.innerHTML = '';

    const scaleOption = document.getElementById('scaleSelect').value;
    const useZip = document.getElementById('zipCheck').checked;

    if (useZip) zip = new JSZip();

    // Load Model
    statusLog.innerText = "Đang tải Model AI (Lần đầu mất khoảng 10-30s)...";
    updateProgress(0, selectedFiles.length, 0, "Đang tải Model...");

    try {
        if (!upscaler) {
            upscaler = new Upscaler({
                model: window['@tensorflow-models/esrgan-slim'].default,
            });
            // Warmup model
            await upscaler.upscale(document.createElement('img'));
        }
    } catch (e) {
        console.error(e);
        alert("Lỗi tải Model AI. Hãy kiểm tra kết nối mạng (cần mạng để tải file model lần đầu).");
        startBtn.disabled = false;
        return;
    }

    // Sequential Processing
    for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const displayIndex = i + 1;
        const percent = Math.round((i / selectedFiles.length) * 100);

        updateProgress(displayIndex, selectedFiles.length, percent, `Đang xử lý: ${file.name}`);

        try {
            const imgUrl = URL.createObjectURL(file);
            const img = new Image();
            img.src = imgUrl;
            await img.decode();

            let resultSrc;

            // Logic Upscale
            if (scaleOption == "8") {
                // Pass 1 (4x)
                statusLog.innerText = `[${displayIndex}/${selectedFiles.length}] ${file.name}: Đang chạy Pass 1 (4x)...`;
                const pass1 = await upscaler.upscale(img, { patchSize: 64, padding: 2 });

                // Pass 2 (4x -> 8x)
                statusLog.innerText = `[${displayIndex}/${selectedFiles.length}] ${file.name}: Đang chạy Pass 2 (8x)...`;
                const imgPass2 = new Image();
                imgPass2.src = pass1;
                await imgPass2.decode();

                resultSrc = await upscaler.upscale(imgPass2, { patchSize: 64, padding: 2 });

            } else if (scaleOption == "4") {
                statusLog.innerText = `[${displayIndex}/${selectedFiles.length}] ${file.name}: Đang xử lý...`;
                resultSrc = await upscaler.upscale(img, { patchSize: 64, padding: 2 });
            } else {
                // 2x
                statusLog.innerText = `[${displayIndex}/${selectedFiles.length}] ${file.name}: Đang xử lý...`;
                resultSrc = await upscaler.upscale(img, { patchSize: 128, padding: 2 });
            }

            // Add to UI
            addResultThumbnail(resultSrc, file.name);

            // Add to Zip
            if (useZip) {
                const base64Data = resultSrc.split(',')[1];
                zip.file(`upscaled_${file.name}`, base64Data, { base64: true });
            }

            // Release memory
            URL.revokeObjectURL(imgUrl);

        } catch (err) {
            console.error(err);
            statusLog.innerText = `Lỗi file ${file.name}: ${err.message}`;
        }
    }

    // Finish
    updateProgress(selectedFiles.length, selectedFiles.length, 100, "Hoàn tất!");

    if (useZip) {
        statusLog.innerText = "Đang nén file Zip...";
        zip.generateAsync({ type: "blob" }).then(function(content) {
            saveAs(content, "upscaled_images.zip");
            statusLog.innerText = "Đã tải xuống file Zip!";
        });
    }

    startBtn.disabled = false;
    startBtn.querySelector('span').innerText = "Hoàn thành - Chọn ảnh mới";
    selectedFiles = []; // Reset list
}

function updateProgress(current, total, percent, status) {
    progressText.innerText = `Xử lý: ${current}/${total}`;
    percentText.innerText = `${percent}%`;
    progressBar.style.width = `${percent}%`;
    if (status) statusLog.innerText = status;
}

function addResultThumbnail(src, name) {
    const div = document.createElement('div');
    div.className = "bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden aspect-square relative group border border-gray-200 dark:border-gray-600 shadow-sm transition-transform hover:scale-[1.02]";
    div.innerHTML = `
        <img src="${src}" class="w-full h-full object-cover">
        <a href="${src}" download="upscaled_${name}" class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition duration-200 cursor-pointer">
            <svg class="w-8 h-8 text-white mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            <span class="text-white text-[10px] px-2 text-center truncate w-full">Tải về</span>
        </a>
    `;
    resultArea.appendChild(div);
}

// --- AUTO YEAR LOGIC ---
const yearText = document.getElementById('yearText');
const startYear = 2026; // Năm bắt đầu của riêng dự án này
const currentYear = new Date().getFullYear();

if (currentYear > startYear) {
    yearText.innerText = `${startYear} - ${currentYear}`;
} else {
    yearText.innerText = startYear;
}
