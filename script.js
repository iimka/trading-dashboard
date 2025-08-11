document.addEventListener('DOMContentLoaded', () => {
    // *** 請將 YOUR_PUBLISHED_CSV_URL 替換成你從 Google Sheet 取得的 CSV 發佈連結 *** #tset
    const ORIGINAL_GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR6cxFMgFZPD5pJ8mkN28C-avK0-QpkZZa4c-m0x8SiS8dxP52Ukx7D0vfxZ9BN8tnc05jKY12frsSq/pub?gid=297705262&single=true&output=csv';

    // CORS 代理的前綴
    const CORS_PROXY_PREFIX = 'https://api.allorigins.win/raw?url=';

    let equityChart = null; // 用來存放圖表實例

    async function fetchData() {
        const statusDiv = document.getElementById('last-updated');
        const controller = new AbortController();
        // 設定 15 秒的超時
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.log('Fetch request timed out.');
        }, 15000);

        // 為了防止快取，我們將時間戳加到原始 Google Sheet URL 上，然後再用代理包裝
        const separator = ORIGINAL_GOOGLE_SHEET_URL.includes('?') ? '&' : '?';
        const urlWithCacheBuster = `${ORIGINAL_GOOGLE_SHEET_URL}${separator}t=${new Date().getTime()}`;
        const finalUrl = `${CORS_PROXY_PREFIX}${encodeURIComponent(urlWithCacheBuster)}`;

        try {
            statusDiv.textContent = '正在從 Google Sheet 載入資料...';
            const response = await fetch(finalUrl, { signal: controller.signal });
            clearTimeout(timeoutId); // 成功取得回應，清除超時

            if (!response.ok) {
                throw new Error(`網路回應錯誤: ${response.statusText}`);
            }
            statusDiv.textContent = '資料下載完成，正在處理...';
            const csvText = await response.text();
            processData(csvText);
            statusDiv.textContent = `上次更新: ${new Date().toLocaleString('zh-TW')}`;
        } catch (error) {
            clearTimeout(timeoutId); // 發生錯誤，也清除超時
            console.error('無法獲取或處理資料:', error);
            let errorMessage = error.message;
            if (error.name === 'AbortError') {
                errorMessage = '請求超時 (15秒)。請檢查您的網路連線或確認 Google Sheet 檔案不會太大。';
            } else if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
                errorMessage = '請求失敗。這通常是 CORS 跨域問題。請確認您是透過本地伺服器 (如 `python -m http.server`) 訪問此頁面，而不是直接打開 HTML 檔案。';
            }
            statusDiv.textContent = `更新失敗: ${errorMessage}`;
        }
    }

    function processData(csvText) {
        // 這個基於正規表示式的解析器比 split(',') 更可靠
        // 它可以處理帶引號的欄位，這些欄位中可能包含逗號
        const parseCsvRow = (row) => {
            const columns = [];
            // 用於尋找逗號分隔值的 Regex，允許引號內的字串
            const regex = /(?:"([^"]*(?:""[^"]*)*)"|([^,]*))(?:,|$)/g;
            let match;
            while ((match = regex.exec(row)) !== null) {
                // 防止因結尾逗號造成的無限迴圈
                if (match[0].length === 0) {
                    break;
                }
                // 如果值是帶引號的，match[1] 會是它。否則，是 match[2]。
                // 帶引號的欄位值需要將其雙引號替換為單引號。
                const value = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
                columns.push(value);
            }
            return columns;
        };

        const rows = csvText.trim().split('\n').slice(1); // 獲取除了標題之外的所有行
        const data = rows.map(row => {
            if (!row.trim()) return null; // 跳過空行
            const columns = parseCsvRow(row);
            if (columns.length < 4) return null; // 確保行具有最少的必要欄位

            const dataType = columns[2] ? columns[2].trim() : '';
            let value = columns[3] ? columns[3].trim() : '';

            // 針對 Equity 和 Position 類型，進行更嚴格的數值清理
            // 這會移除數字中的逗號，以及尾隨的非數字字元 (例如意外的引號)
            if (dataType === 'Equity' || dataType === 'Position') {
                value = value.replace(/,/g, '').replace(/[^\d.-].*$/, '');
            }

            return {
                timestamp: new Date(columns[0] ? columns[0].trim() : null),
                systemId: columns[1] ? columns[1].trim() : 'Unknown',
                dataType: dataType,
                value: value,
                details: columns.slice(4).join(',').trim() // 合併剩餘部分作為 details
            };
        }).filter(d => d && d.systemId && d.timestamp instanceof Date && !isNaN(d.timestamp)); // 過濾掉無效行

        // 根據時間戳排序，確保資料是按時間順序處理的
        data.sort((a, b) => a.timestamp - b.timestamp);

        document.getElementById('last-updated').textContent = '資料處理完成，正在渲染畫面...';
        renderStatus(data);
        renderEquityCurve(data);
        renderPositions(data);
        renderSignals(data);
    }

    function renderStatus(data) {
        const statusContainer = document.getElementById('system-status-container');
        // 找到每個系統最新的狀態
        const latestStatus = {};
        data.filter(d => d.dataType === 'Status').forEach(d => {
            latestStatus[d.systemId] = d;
        });

        statusContainer.innerHTML = ''; // 清空舊內容
        if (Object.keys(latestStatus).length === 0) {
            statusContainer.innerHTML = '<p>尚無系統狀態資料。</p>';
            return;
        }

        for (const systemId in latestStatus) {
            const statusData = latestStatus[systemId];
            const box = document.createElement('div');
            box.className = 'status-box';
            box.classList.add(statusData.value.toLowerCase() === 'running' ? 'running' : 'stopped');
            box.textContent = `${systemId}: ${statusData.value}`;
            if (statusData.details) {
                box.title = `詳細資訊: ${statusData.details}`; // 滑鼠懸停時顯示詳細錯誤
            }
            statusContainer.appendChild(box);
        }
    }

    function renderEquityCurve(data) {
        const ctx = document.getElementById('equity-chart').getContext('2d');
        // 我們需要按時間排序的資金數據，processData 已經對整個數據集進行了排序
        const equityData = data.filter(d => d.dataType === 'Equity');

        if (equityData.length === 0) {
            if (equityChart) equityChart.destroy();
            // 如果需要，可以在畫布上顯示一條訊息
            return;
        }

        // 按確切的時間戳對更新進行分組
        const equityByTime = {};
        equityData.forEach(d => {
            const timeKey = d.timestamp.toISOString();
            if (!equityByTime[timeKey]) {
                equityByTime[timeKey] = [];
            }
            // 延後解析，先將原始值存入，以利後續進行更嚴格的檢查
            equityByTime[timeKey].push({ systemId: d.systemId, value: d.value });
        });

        const sortedTimeKeys = Object.keys(equityByTime).sort();
        
        const chartLabels = [];
        const chartDataPoints = [];
        const latestEquityPerSystem = {};
        // 取得所有不重複的系統 ID，並將其初始資金設為 0
        [...new Set(equityData.map(d => d.systemId))].forEach(id => {
            latestEquityPerSystem[id] = 0;
        });

        // 按時間順序處理每個時間點
        sortedTimeKeys.forEach(timeKey => {
            // 應用此時間戳的所有更新，並進行有效性檢查
            equityByTime[timeKey].forEach(update => {
                const parsedValue = parseFloat(update.value);
                // 只有當解析出的值是有效的、有限的數字時，才更新該系統的資金
                // 這可以防止空值或文字覆蓋掉最後的正確數值
                if (isFinite(parsedValue)) {
                    latestEquityPerSystem[update.systemId] = parsedValue;
                }
            });

            // 更新後，通過加總所有系統的最新資金來計算新的總額
            const totalEquity = Object.values(latestEquityPerSystem).reduce((sum, val) => sum + val, 0);

            chartLabels.push(new Date(timeKey));
            chartDataPoints.push(totalEquity);
        });

        if (equityChart) {
            equityChart.destroy(); // 如果圖表已存在，先銷毀再重畫
        }

        equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels.map(l => l.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
                datasets: [{
                    label: '總資金曲線',
                    data: chartDataPoints,
                    borderColor: '#4a90e2',
                    backgroundColor: 'rgba(74, 144, 226, 0.2)',
                    fill: true,
                    tension: 0.1,
                    pointRadius: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#e0e0e0', autoSkip: true, maxTicksLimit: 20 } },
                    y: { ticks: { color: '#e0e0e0' } }
                },
                plugins: { legend: { labels: { color: '#e0e0e0' } } }
            }
        });
    }

    function renderPositions(data) {
        const positionsTbody = document.querySelector('#positions-table tbody');
        const latestPositions = {};
        data.filter(d => d.dataType === 'Position').forEach(d => {
            // 假設 details 格式為 "Symbol:BTCUSDT,Entry:34000"
            const symbol = d.details.split(',')[0].split(':')[1] || 'N/A';
            latestPositions[`${d.systemId}-${symbol}`] = d;
        });

        positionsTbody.innerHTML = '';
        Object.values(latestPositions).forEach(pos => {
            const positionValue = parseFloat(pos.value);
            if (isFinite(positionValue) && positionValue !== 0) { // 只顯示還有持倉的部位，並確保值是有效數字
                const row = positionsTbody.insertRow();
                const detailsParts = pos.details.split(',').map(p => p.trim());
                const symbol = detailsParts.find(p => p.toLowerCase().startsWith('symbol:'))?.split(':')[1] || 'N/A';
                const entry = detailsParts.find(p => p.toLowerCase().startsWith('entry:'))?.split(':')[1] || 'N/A';
                
                row.innerHTML = `<td>${pos.systemId}</td><td>${symbol}</td><td>${pos.value}</td><td>${entry}</td>`;
            }
        });
    }

    function renderSignals(data) {
        const signalsList = document.getElementById('signals-list');
        const latestSignals = data.filter(d => d.dataType === 'Signal')
                                 .slice(-10) // 只顯示最新的 10 條信號
                                 .reverse();

        signalsList.innerHTML = '';
        latestSignals.forEach(sig => {
            const li = document.createElement('li');
            li.textContent = `[${sig.timestamp.toLocaleTimeString('zh-TW')}] ${sig.systemId} - ${sig.value} @ ${sig.details}`;
            signalsList.appendChild(li);
        });
    }

    // 初始載入並設定定時刷新 (例如每 60 秒)
    fetchData();
    setInterval(fetchData, 60000);
});
