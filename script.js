document.addEventListener('DOMContentLoaded', () => {
    // *** 請將 YOUR_PUBLISHED_CSV_URL 替換成你從 Google Sheet 取得的 CSV 發佈連結 ***
    const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR6cxFMgFZPD5pJ8mkN28C-avK0-QpkZZa4c-m0x8SiS8dxP52Ukx7D0vfxZ9BN8tnc05jKY12frsSq/pub?gid=297705262&single=true&output=csv';

    let equityChart = null; // 用來存放圖表實例

    async function fetchData() {
        // 防止瀏覽器快取舊的 CSV 檔案
        const urlWithCacheBuster = `${GOOGLE_SHEET_URL}?t=${new Date().getTime()}`;
        try {
            const response = await fetch(urlWithCacheBuster);
            if (!response.ok) {
                throw new Error(`網路回應錯誤: ${response.statusText}`);
            }
            const csvText = await response.text();
            processData(csvText);
            document.getElementById('last-updated').textContent = `上次更新: ${new Date().toLocaleString('zh-TW')}`;
        } catch (error) {
            console.error('無法獲取或處理資料:', error);
            document.getElementById('last-updated').textContent = `更新失敗: ${error.message}`;
        }
    }

    function processData(csvText) {
        const rows = csvText.trim().split('\n').slice(1); // 分割成行並跳過標題
        const data = rows.map(row => {
            // 簡單的 CSV 解析，對於包含逗號的欄位可能不夠穩健
            const columns = row.split(',');
            return {
                timestamp: new Date(columns[0]),
                systemId: columns[1],
                dataType: columns[2],
                value: columns[3],
                details: columns.slice(4).join(',').trim() // 合併剩餘部分作為 details
            };
        }).filter(d => d.systemId && d.timestamp instanceof Date && !isNaN(d.timestamp)); // 過濾掉無效行

        // 根據時間戳排序，確保資料是按時間順序處理的
        data.sort((a, b) => a.timestamp - b.timestamp);

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
        const equityData = data.filter(d => d.dataType === 'Equity');

        // 匯總所有系統的資金
        const aggregatedEquity = {};
        equityData.forEach(d => {
            const timeKey = d.timestamp.toISOString();
            if (!aggregatedEquity[timeKey]) {
                aggregatedEquity[timeKey] = { total: 0, systems: {} };
            }
            // 確保同一個系統在同一個時間點只被記錄一次
            aggregatedEquity[timeKey].systems[d.systemId] = parseFloat(d.value);
        });

        // 重新計算每個時間點的總資金
        Object.keys(aggregatedEquity).forEach(timeKey => {
            aggregatedEquity[timeKey].total = Object.values(aggregatedEquity[timeKey].systems).reduce((sum, val) => sum + val, 0);
        });
        
        const sortedLabels = Object.keys(aggregatedEquity).sort();
        const chartData = sortedLabels.map(label => aggregatedEquity[label].total);

        if (equityChart) {
            equityChart.destroy(); // 如果圖表已存在，先銷毀再重畫
        }

        equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedLabels.map(l => new Date(l).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
                datasets: [{
                    label: '總資金曲線',
                    data: chartData,
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
                scales: { x: { ticks: { color: '#e0e0e0' } }, y: { ticks: { color: '#e0e0e0' } } },
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
            if (parseFloat(pos.value) !== 0) { // 只顯示還有持倉的部位
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
