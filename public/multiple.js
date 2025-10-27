// API 기본 URL 설정 - 현재 도메인에서 자동으로 가져옴
const API_BASE_URL = window.location.origin;

// 알림 함수
function showNotification(message, isError = false) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    if (isError) {
        notification.classList.add('error');
    }
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // 3초 후 알림 제거
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

document.addEventListener('DOMContentLoaded', function() {
    // 세션 상태 확인
    console.log('다중 URL 페이지 로드: 세션 상태 확인 중');
    
    fetch('/api/me', {
        method: 'GET',
        credentials: 'include', // 세션 쿠키 포함
        headers: {
            'Cache-Control': 'no-cache'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data && data.success && data.user) {
            console.log('현재 로그인된 사용자:', data.user.username);
        } else {
            console.log('로그인되지 않은 상태');
        }
    })
    .catch(error => {
        console.error('로그인 상태 확인 오류:', error);
    });
    
    // DOM 요소
    const longUrlsTextarea = document.getElementById('longUrls');
    const clearBtn = document.getElementById('clearBtn');
    const shortenBtn = document.getElementById('shortenBtn');
    const resultContainer = document.getElementById('resultContainer');
    const excelFileInput = document.getElementById('excelFile');
    const fileNameDisplay = document.getElementById('fileName');
    const processExcelBtn = document.getElementById('processExcelBtn');
    
    // 단축된 URL 저장
    let shortenedUrls = [];
    
    // 파일 선택 시 파일명 표시
    excelFileInput.addEventListener('change', function(e) {
        const fileName = e.target.files[0] ? e.target.files[0].name : '선택된 파일 없음';
        fileNameDisplay.textContent = fileName;
    });
    
    // 엑셀 파일 처리 버튼 클릭
    processExcelBtn.addEventListener('click', function() {
        const file = excelFileInput.files[0];
        if (!file) {
            showNotification('엑셀 파일을 선택해주세요.', true);
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // 첫 번째 시트 사용
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // 엑셀 데이터를 JSON으로 변환
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                if (jsonData.length === 0) {
                    showNotification('엑셀 파일에 데이터가 없습니다.', true);
                    return;
                }
                
                // URL 추출
                const urls = [];
                
                // 다양한 열 이름 처리
                const possibleUrlColumns = ['URL', 'url', 'Url', 'link', 'Link', '링크', '주소', 'Address', 'address'];
                
                jsonData.forEach(row => {
                    // 가능한 URL 컬럼명 검색
                    let url = null;
                    for (const colName of possibleUrlColumns) {
                        if (row[colName]) {
                            url = row[colName];
                            break;
                        }
                    }
                    
                    // URL 컬럼을 찾지 못했으면 객체의 첫 번째 값 사용
                    if (!url) {
                        const firstValue = Object.values(row)[0];
                        if (typeof firstValue === 'string' && isValidUrl(firstValue)) {
                            url = firstValue;
                        }
                    }
                    
                    if (url) {
                        urls.push(url);
                    }
                });
                
                if (urls.length === 0) {
                    showNotification('엑셀 파일에서 유효한 URL을 찾을 수 없습니다.', true);
                    return;
                }
                
                // URL을 텍스트 영역에 표시
                longUrlsTextarea.value = urls.join('\n');
                
                // 바로 단축 처리
                shortenBtn.click();
                
                showNotification(`엑셀에서 ${urls.length}개의 URL을 추출했습니다.`, false);
                
            } catch (error) {
                console.error('Error processing Excel file:', error);
                showNotification('엑셀 파일 처리 중 오류가 발생했습니다.', true);
            }
        };
        
        reader.onerror = function() {
            showNotification('파일을 읽는 중 오류가 발생했습니다.', true);
        };
        
        reader.readAsArrayBuffer(file);
    });
    
    // 초기화 버튼 클릭
    clearBtn.addEventListener('click', function() {
        longUrlsTextarea.value = '';
        resultContainer.innerHTML = '';
        // 파일 입력도 초기화
        excelFileInput.value = '';
        fileNameDisplay.textContent = '선택된 파일 없음';
    });
    
    // 단축하기 버튼 클릭
    shortenBtn.addEventListener('click', async function() {
        const longUrlsText = longUrlsTextarea.value.trim();
        if (!longUrlsText) {
            showNotification('URL을 입력해주세요.', true);
            return;
        }
        
        // 텍스트를 줄바꿈으로 구분하여 배열로 변환
        const urls = longUrlsText.split('\n')
            .map(url => url.trim())
            .filter(url => url);
        
        if (urls.length === 0) {
            showNotification('유효한 URL을 입력해주세요.', true);
            return;
        }
        
        try {
            showNotification('URL 변환 중...', false);
            
            // 결과 컨테이너 초기화
            resultContainer.innerHTML = '';
            shortenedUrls = [];
            
            console.log('다중 URL 단축 전 세션 쿠키 확인');
            
            // 일괄 URL 단축 API 호출
            try {
                const response = await fetch(`${API_BASE_URL}/shorten-multiple`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache'
                    },
                    body: JSON.stringify({ urls }),
                    credentials: 'include' // 세션 쿠키 포함
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (!data.success || !data.urls) {
                    throw new Error('서버 응답 오류');
                }
                
                // 결과 처리
                shortenedUrls = data.urls;
                
                // 결과 표시
                displayResults(shortenedUrls);
                
                showNotification(`${shortenedUrls.length}개의 URL이 단축되었습니다`, false);
                
            } catch (error) {
                console.error('Error in bulk shortening:', error);
                
                // 개별 URL 단축 (백업 방법)
                showNotification('개별 URL 처리 중...', false);
                
                for (const url of urls) {
                    try {
                        const shortUrl = await shortenUrl(url);
                        const resultData = { originalUrl: url, shortUrl };
                        shortenedUrls.push(resultData);
                    } catch (error) {
                        console.error('URL 단축 실패:', error);
                        shortenedUrls.push({ originalUrl: url, shortUrl: '변환 실패', error: true });
                    }
                }
                
                // 결과 표시
                displayResults(shortenedUrls);
            }
            
        } catch (error) {
            console.error('URL 처리 실패:', error);
            showNotification('URL 처리 중 오류가 발생했습니다', true);
        }
    });
    
    // 결과 표시 함수
    function displayResults(results) {
        // 결과 테이블 생성
        const table = document.createElement('table');
        table.className = 'result-table';
        
        // 테이블 헤더
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>원본 URL</th>
                <th>단축 URL</th>
                <th>복사</th>
            </tr>
        `;
        table.appendChild(thead);
        
        // 테이블 바디
        const tbody = document.createElement('tbody');
        
        results.forEach(result => {
            const row = document.createElement('tr');
            
            const originalCell = document.createElement('td');
            originalCell.textContent = result.originalUrl;
            originalCell.style.wordBreak = 'break-all';
            
            const shortCell = document.createElement('td');
            shortCell.textContent = result.shortUrl;
            shortCell.style.wordBreak = 'break-all';
            if (result.error) {
                shortCell.style.color = '#e74c3c';
            }
            
            const actionCell = document.createElement('td');
            if (!result.error) {
                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-btn';
                copyBtn.textContent = '복사';
                copyBtn.onclick = () => copyToClipboard(result.shortUrl);
                actionCell.appendChild(copyBtn);
            }
            
            row.appendChild(originalCell);
            row.appendChild(shortCell);
            row.appendChild(actionCell);
            
            tbody.appendChild(row);
        });
        
        table.appendChild(tbody);
        
        // 결과 컨테이너에 테이블 추가
        resultContainer.appendChild(table);
        
        // 복사 버튼 표시
        const copyAllBtn = document.createElement('button');
        copyAllBtn.className = 'copy-all-btn';
        copyAllBtn.textContent = '모든 URL 복사';
        copyAllBtn.onclick = () => {
            // 오류 없는 URL만 수집
            const validUrls = results
                .filter(result => !result.error)
                .map(result => result.shortUrl)
                .join('\n');
            
            if (validUrls) {
                copyToClipboard(validUrls);
                showNotification('모든 단축 URL이 복사되었습니다', false);
            } else {
                showNotification('복사할 URL이 없습니다', true);
            }
        };
        
        resultContainer.appendChild(copyAllBtn);
    }
    
    // URL 단축 함수
    async function shortenUrl(longUrl) {
        // http/https 없으면 자동으로 붙이기
        if (!/^https?:\/\//i.test(longUrl)) {
            longUrl = 'https://' + longUrl;
        }
        
        const response = await fetch(`${API_BASE_URL}/shorten`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache' 
            },
            body: JSON.stringify({ url: longUrl }),
            credentials: 'include' // 세션 쿠키 포함
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.shortUrl) {
            throw new Error('Invalid response from server');
        }
        
        return data.shortUrl;
    }
    
    // 클립보드에 복사 함수
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text)
            .then(() => {
                showNotification('URL이 복사되었습니다!', false);
            })
            .catch(err => {
                console.error('복사 실패:', err);
                showNotification('URL 복사에 실패했습니다.', true);
            });
    }
    
    // URL 유효성 검사 함수
    function isValidUrl(url) {
        try {
            // http/https 없으면 자동으로 붙이기
            if (!/^https?:\/\//i.test(url)) {
                url = 'https://' + url;
            }
            
            const urlObj = new URL(url);
            // 도메인 이름에 점(.)이 포함되어 있고, 최소 길이 조건을 만족하는지 확인
            return urlObj.hostname.includes('.') && urlObj.hostname.length >= 3;
        } catch (e) {
            return false;
        }
    }
}); 