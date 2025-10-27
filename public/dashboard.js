// ───────────────────────────────────────────────────────────
// 메모 기능용 유틸
// ───────────────────────────────────────────────────────────
const __rowState = new Map(); // key: shortCode, val: { timerId, inFlightController }

function __debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// 상태칩 업데이트 (인라인 스타일로 안전 적용)
function __setStatusChip(el, type, text) {
  if (!el) return;
  el.textContent = text || '';
  el.style.borderRadius = '999px';
  el.style.padding = '2px 8px';
  el.style.fontSize = '12px';
  el.style.whiteSpace = 'nowrap';

  // 기본색
  el.style.background = '#f6f8fb';
  el.style.color = '#334155';
  if (type === 'saving') { el.style.background = '#fff7ed'; el.style.color = '#9a3412'; }
  if (type === 'saved')  { el.style.background = '#ecfdf5'; el.style.color = '#065f46'; }
  if (type === 'error')  { el.style.background = '#fef2f2'; el.style.color = '#991b1b'; }
}

// 실제 저장 요청
async function __saveMemo(shortCode, memo, statusEl, force = false) {
  const baseUrl = window.location.origin;

  // 진행 중 요청 취소(최신만 유지)
  const st = __rowState.get(shortCode) || {};
  if (st.inFlightController) {
    try { st.inFlightController.abort(); } catch(e) {}
  }
  const controller = new AbortController();
  st.inFlightController = controller;
  __rowState.set(shortCode, st);

  __setStatusChip(statusEl, 'saving', '저장 중…');
  try {
    const res = await fetch(`${baseUrl}/urls/${encodeURIComponent(shortCode)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memo }),
      signal: controller.signal
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>'');
      throw new Error(`HTTP ${res.status} ${t}`);
    }
    __setStatusChip(statusEl, 'saved', '저장됨');
    setTimeout(() => __setStatusChip(statusEl, null, '대기'), 2000);
  } catch (err) {
    if (err.name === 'AbortError') return; // 새 요청으로 대체됨
    __setStatusChip(statusEl, 'error', '실패(재시도)');
    console.error('[메모 저장 실패]', shortCode, err);
    if (force) alert('메모 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    const cur = __rowState.get(shortCode);
    if (cur && cur.inFlightController === controller) cur.inFlightController = null;
  }
}

// 전역에서 템플릿 oninput/onclick이 부를 수 있게 노출
window.__memoInputChanged = function(shortCode, textareaEl, statusEl) {
  // 상태칩 표시 및 디바운스 저장 예약
  __setStatusChip(statusEl, 'saving', '저장 예정…');

  if (!__rowState.get(shortCode)) __rowState.set(shortCode, {});
  const st = __rowState.get(shortCode);
  if (!st.debounced) {
    st.debounced = __debounce((sc, val, sEl) => __saveMemo(sc, val, sEl), 800);
  }
  st.debounced(shortCode, textareaEl.value, statusEl);
};

window.__memoSaveClick = function(shortCode, textareaEl, statusEl) {
  __saveMemo(shortCode, textareaEl.value, statusEl, /*force*/true);
};

// ⌘/Ctrl + S 로 포커스된 메모만 즉시 저장
document.addEventListener('keydown', (e) => {
  const mac = navigator.platform.toUpperCase().includes('MAC');
  const isSave = (mac && e.metaKey && e.key.toLowerCase() === 's') || (!mac && e.ctrlKey && e.key.toLowerCase() === 's');
  if (!isSave) return;

  const active = document.activeElement;
  if (active && active.classList && active.classList.contains('memo-textarea')) {
    e.preventDefault();
    const shortCode = active.getAttribute('data-shortcode');
    const statusEl = active.closest('td').querySelector('.memo-status-chip');
    __saveMemo(shortCode, active.value, statusEl, /*force*/true);
  }
});

// ───────────────────────────────────────────────────────────
// 원본 코드 + 메모 컬럼/기능 추가
// ───────────────────────────────────────────────────────────

// URL 목록 로드
function loadUrls() {
    // 현재 도메인 기반으로 설정
    const baseUrl = window.location.origin;
    
    console.log('URL 목록 로드 시도');
        
    fetch(`${baseUrl}/urls`, {
        method: 'GET',
        headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        },
        credentials: 'include' // 세션 쿠키 포함
    })
        .then(response => {
            console.log('URL 목록 응답 상태:', response.status);
            if (!response.ok) {
                if (response.status === 401) {
                    // 로그인이 필요한 경우
                    console.log('인증되지 않음, 로그인 페이지로 이동');
                    window.location.href = '/login';
                    return;
                }
                throw new Error('서버 응답 오류');
            }
            return response.json();
        })
        .then(urls => {
            console.log('URL 목록 수신 완료:', urls ? urls.length : 0);
            const tbody = document.getElementById('dashboard-tbody');
            tbody.innerHTML = '';

            if (!urls || urls.length === 0) {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td colspan="9" style="text-align: center; padding: 20px;">
                        등록된 URL이 없습니다.
                    </td>
                `;
                tbody.appendChild(row);
                return;
            }

            // 현재 사용자 정보 가져오기
            fetch('/api/me', {
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            })
            .then(response => response.json())
            .then(userData => {
                let currentUser = '';
                if (userData && userData.success && userData.user) {
                    currentUser = userData.user.username;
                }

                urls.forEach(url => {
                    // 사용자 정보 표시 - URL 생성자에 따라 다르게 표시
                    let displayUsername = '비회원';
                    if (url.username) displayUsername = url.username;

                    // 행 구성: 템플릿 문자열 대신 DOM API 사용 (메모 엘리먼트 참조 필요)
                    const tr = document.createElement('tr');

                    // 1) 복사 버튼
                    const tdCopy = document.createElement('td');
                    tdCopy.className = 'action-cell';
                    tdCopy.style.cssText = 'width:5%;text-align:center;';
                    const copyBtn = document.createElement('button');
                    copyBtn.className = 'copy-btn';
                    copyBtn.textContent = '복사';
                    copyBtn.style.cssText = 'padding:4px 8px;background-color:#1877f2;color:#fff;border:none;border-radius:4px;cursor:pointer;';
                    copyBtn.onclick = () => copyToClipboard(url.shortUrl);
                    tdCopy.appendChild(copyBtn);

                    // 2) Short URL
                    const tdShort = document.createElement('td');
                    tdShort.className = 'url-cell';
                    tdShort.style.cssText = 'width:15%;text-align:center;';
                    const aShort = document.createElement('a');
                    aShort.href = url.shortUrl;
                    aShort.target = '_blank';
                    aShort.className = 'url-link';
                    aShort.textContent = url.shortUrl;
                    tdShort.appendChild(aShort);

                    // 3) Long URL
                    const tdLong = document.createElement('td');
                    tdLong.className = 'url-cell';
                    tdLong.style.cssText = 'width:30%;text-align:center;word-break:break-all;';
                    tdLong.textContent = url.longUrl;

                    // 4) 오늘 방문
                    const tdToday = document.createElement('td');
                    tdToday.className = 'visits-cell';
                    tdToday.style.cssText = 'width:8%;text-align:center;';
                    tdToday.textContent = url.todayVisits || 0;

                    // 5) 누적 방문
                    const tdTotal = document.createElement('td');
                    tdTotal.className = 'visits-cell';
                    tdTotal.style.cssText = 'width:8%;text-align:center;';
                    tdTotal.textContent = url.totalVisits || 0;

                    // 6) 사용자
                    const tdUser = document.createElement('td');
                    tdUser.className = 'user-cell';
                    tdUser.style.cssText = 'width:10%;text-align:center;';
                    tdUser.textContent = displayUsername;

                    // 7) ✅ 메모
                    const tdMemo = document.createElement('td');
                    tdMemo.style.cssText = 'width:16%;text-align:left;';
                    // wrap
                    const memoWrap = document.createElement('div');
                    memoWrap.style.display = 'flex';
                    memoWrap.style.flexDirection = 'column';
                    memoWrap.style.gap = '6px';

                    const memoTextarea = document.createElement('textarea');

                    memoTextarea.className = 'memo-textarea';
                    memoTextarea.setAttribute('data-shortcode', url.shortCode);
                    memoTextarea.placeholder = '이 URL에 대한 메모를 입력하세요…';
                    memoTextarea.value = url.memo || '';
                    memoTextarea.style.width = '90%';
                    memoTextarea.style.minHeight = '38px';
                    memoTextarea.style.maxHeight = '120px';
                    memoTextarea.style.resize = 'vertical';
                    memoTextarea.style.border = '1px solid #e6eaf2';
                    memoTextarea.style.borderRadius = '8px';
                    memoTextarea.style.padding = '8px 10px';
                    memoTextarea.style.fontSize = '13px';
                    memoTextarea.style.lineHeight = '1.4';
                    memoTextarea.style.background = '#fff';
                    

                    const memoActions = document.createElement('div');
                    memoActions.style.display = 'flex';
                    memoActions.style.alignItems = 'center';
                    memoActions.style.justifyContent = 'space-between';
                    memoActions.style.gap = '8px';

                    const statusChip = document.createElement('span');
                    statusChip.className = 'memo-status-chip';

                    
       
                    memoTextarea.addEventListener('input', () => {
                      window.__memoInputChanged(url.shortCode, memoTextarea, statusChip);
                    });

                    memoActions.appendChild(statusChip);

                    memoWrap.appendChild(memoTextarea);
                    memoWrap.appendChild(memoActions);
                    tdMemo.appendChild(memoWrap);

                    // 8) 관리(삭제)
                    const tdDel = document.createElement('td');
                    tdDel.className = 'action-cell';
                    tdDel.style.cssText = 'width:7%;text-align:center;';
                    const delBtn = document.createElement('button');
                    delBtn.className = 'delete-btn';
                    delBtn.textContent = '삭제';
                    delBtn.onclick = () => deleteUrl(url.shortCode);
                    tdDel.appendChild(delBtn);

                    // 9) 상세
                    const tdDetail = document.createElement('td');
                    tdDetail.className = 'action-cell';
                    tdDetail.style.cssText = 'width:7%;text-align:center;';
                    const detailBtn = document.createElement('button');
                    detailBtn.className = 'detail-btn';
                    detailBtn.textContent = '보기';
                    detailBtn.onclick = () => showDetails(url.shortCode);
                    tdDetail.appendChild(detailBtn);

                    tr.appendChild(tdCopy);
                    tr.appendChild(tdShort);
                    tr.appendChild(tdLong);
                    tr.appendChild(tdToday);
                    tr.appendChild(tdTotal);
                    tr.appendChild(tdUser);
                    tr.appendChild(tdMemo);   // ✅ 메모 컬럼
                    tr.appendChild(tdDel);
                    tr.appendChild(tdDetail);

                    tbody.appendChild(tr);
                });
            })
            .catch(error => {
                // 사용자 정보를 가져오는데 실패해도 URL 목록은 표시
                console.error('Error getting user info:', error);
                
                urls.forEach(url => {
                    let displayUsername = '비회원';
                    if (url.username) displayUsername = url.username;

                    const tr = document.createElement('tr');

                    const tdCopy = document.createElement('td');
                    tdCopy.className = 'action-cell';
                    tdCopy.style.cssText = 'width:5%;text-align:center;';
                    const copyBtn = document.createElement('button');
                    copyBtn.className = 'copy-btn';
                    copyBtn.textContent = '복사';
                    copyBtn.style.cssText = 'padding:4px 8px;background-color:#1877f2;color:#fff;border:none;border-radius:4px;cursor:pointer;';
                    copyBtn.onclick = () => copyToClipboard(url.shortUrl);
                    tdCopy.appendChild(copyBtn);

                    const tdShort = document.createElement('td');
                    tdShort.className = 'url-cell';
                    tdShort.style.cssText = 'width:15%;text-align:center;';
                    const aShort = document.createElement('a');
                    aShort.href = url.shortUrl;
                    aShort.target = '_blank';
                    aShort.className = 'url-link';
                    aShort.textContent = url.shortUrl;
                    tdShort.appendChild(aShort);

                    const tdLong = document.createElement('td');
                    tdLong.className = 'url-cell';
                    tdLong.style.cssText = 'width:30%;text-align:center;word-break:break-all;';
                    tdLong.textContent = url.longUrl;

                    const tdToday = document.createElement('td');
                    tdToday.className = 'visits-cell';
                    tdToday.style.cssText = 'width:8%;text-align:center;';
                    tdToday.textContent = url.todayVisits || 0;

                    const tdTotal = document.createElement('td');
                    tdTotal.className = 'visits-cell';
                    tdTotal.style.cssText = 'width:8%;text-align:center;';
                    tdTotal.textContent = url.totalVisits || 0;

                    const tdUser = document.createElement('td');
                    tdUser.className = 'user-cell';
                    tdUser.style.cssText = 'width:10%;text-align:center;';
                    tdUser.textContent = displayUsername;

                    // ✅ 메모 (오프라인 표시/저장 가능)
                    const tdMemo = document.createElement('td');
                    tdMemo.style.cssText = 'width:16%;text-align:left;';
                    const memoWrap = document.createElement('div');
                    memoWrap.style.display = 'flex';
                    memoWrap.style.flexDirection = 'column';
                    memoWrap.style.gap = '6px';

                    const memoTextarea = document.createElement('textarea');
                    memoTextarea.className = 'memo-textarea';
                    memoTextarea.setAttribute('data-shortcode', url.shortCode);
                    memoTextarea.placeholder = '이 URL에 대한 메모를 입력하세요…';
                    memoTextarea.value = url.memo || '';
                    memoTextarea.style.width = '100%';
                    memoTextarea.style.minHeight = '38px';
                    memoTextarea.style.maxHeight = '120px';
                    memoTextarea.style.resize = 'vertical';
                    memoTextarea.style.border = '1px solid #e6eaf2';
                    memoTextarea.style.borderRadius = '8px';
                    memoTextarea.style.padding = '8px 10px';
                    memoTextarea.style.fontSize = '13px';
                    memoTextarea.style.lineHeight = '1.4';
                    memoTextarea.style.background = '#fff';

                    const memoActions = document.createElement('div');
                    memoActions.style.display = 'flex';
                    memoActions.style.alignItems = 'center';
                    memoActions.style.justifyContent = 'space-between';
                    memoActions.style.gap = '8px';

                    const statusChip = document.createElement('span');
                    statusChip.className = 'memo-status-chip';
                    __setStatusChip(statusChip, null, '대기');

                    const saveBtn = document.createElement('button');
                    saveBtn.textContent = '저장';
                    saveBtn.style.cssText = 'padding:6px 10px;border-radius:8px;border:1px solid #e6eaf2;background:#fff;cursor:pointer;font-size:12px;';
                    saveBtn.onclick = () => window.__memoSaveClick(url.shortCode, memoTextarea, statusChip);

                    memoTextarea.addEventListener('input', () => {
                      window.__memoInputChanged(url.shortCode, memoTextarea, statusChip);
                    });

                    memoActions.appendChild(statusChip);
                    memoActions.appendChild(saveBtn);
                    memoWrap.appendChild(memoTextarea);
                    memoWrap.appendChild(memoActions);
                    tdMemo.appendChild(memoWrap);

                    const tdDel = document.createElement('td');
                    tdDel.className = 'action-cell';
                    tdDel.style.cssText = 'width:7%;text-align:center;';
                    const delBtn = document.createElement('button');
                    delBtn.className = 'delete-btn';
                    delBtn.textContent = '삭제';
                    delBtn.onclick = () => deleteUrl(url.shortCode);
                    tdDel.appendChild(delBtn);

                    const tdDetail = document.createElement('td');
                    tdDetail.className = 'action-cell';
                    tdDetail.style.cssText = 'width:7%;text-align:center;';
                    const detailBtn = document.createElement('button');
                    detailBtn.className = 'detail-btn';
                    detailBtn.textContent = '보기';
                    detailBtn.onclick = () => showDetails(url.shortCode);
                    tdDetail.appendChild(detailBtn);

                    tr.appendChild(tdCopy);
                    tr.appendChild(tdShort);
                    tr.appendChild(tdLong);
                    tr.appendChild(tdToday);
                    tr.appendChild(tdTotal);
                    tr.appendChild(tdUser);
                    tr.appendChild(tdMemo); // ✅
                    tr.appendChild(tdDel);
                    tr.appendChild(tdDetail);

                    tbody.appendChild(tr);
                });
            });
        })
        .catch(error => {
            console.error('Error:', error);
            alert('URL 목록을 불러오는 중 오류가 발생했습니다.');
        });
}

// URL 삭제
function deleteUrl(shortCode) {
    // 현재 도메인 기반으로 설정
    const baseUrl = window.location.origin;
        
    if (confirm('정말 삭제하시겠습니까?')) {
        fetch(`${baseUrl}/urls/${shortCode}`, {
            method: 'DELETE',
            credentials: 'include' // 세션 쿠키 포함
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('삭제 실패');
            }
            loadUrls();
        })
        .catch(error => {
            console.error('Error:', error);
            alert('URL 삭제 중 오류가 발생했습니다.');
        });
    }
}

// 상세 정보 표시 (원본 유지)
function showDetails(shortCode) {
    // 현재 도메인 기반으로 설정
    const baseUrl = window.location.origin;
    
    fetch(`${baseUrl}/urls/${shortCode}/details`, {
        credentials: 'include' // 세션 쿠키 포함
    })
        .then(response => {
            if (!response.ok) {
                throw new Error('상세 정보 조회 실패');
            }
            return response.json();
        })
        .then(async details => {
            // 기존 모달이 있다면 제거
            const existingModal = document.querySelector('.modal-overlay');
            if (existingModal) {
                existingModal.remove();
            }
            // 날짜 포맷팅
            const date = new Date(details.createdAt);
            const formattedDate = date.getFullYear() + '. ' + String(date.getMonth()+1).padStart(2,'0') + '. ' + String(date.getDate()).padStart(2,'0') + '. ' +
                String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0') + ':' + String(date.getSeconds()).padStart(2,'0');
            // IP 괄호로 한 줄(맨 앞 IP만)
            let ipDisplay = details.ip || 'localhost';
            if (ipDisplay && typeof ipDisplay === 'string') {
                ipDisplay = '(' + ipDisplay.split(',')[0].trim() + ')';
            }
            // logs 표 생성
            let logsTable = '';
            if (details.logs && details.logs.length > 0) {
                logsTable = `<table style="width:100%;margin-top:10px;font-size:13px;text-align:center;"><thead><tr><th style='text-align:center;'>IP</th><th style='text-align:center;'>접속시간</th></tr></thead><tbody>`;
                details.logs.forEach(log => {
                    const t = new Date(log.time).toLocaleString('ko-KR', {year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
                    logsTable += `<tr><td style='text-align:center;'>${log.ip}</td><td style='text-align:center;'>${t}</td></tr>`;
                });
                logsTable += '</tbody></table>';
            } else {
                logsTable = '<div style="color:#888;font-size:13px;">접속 기록 없음</div>';
            }
            // 모달 생성
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <div class="modal-title">단축 도메인 정보: ${shortCode}</div>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div style="text-align:right;margin-bottom:10px;">
                        <button id="modal-excel-download-btn" style="padding:7px 22px;font-size:1.05rem;background:#19c37d;color:#fff;border:none;border-radius:7px;cursor:pointer;">엑셀 다운로드</button>
                    </div>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <div class="detail-label">생성일 / IP</div>
                            <div class="detail-value">${formattedDate} <br>${ipDisplay}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">하루 접속허용수</div>
                            <div class="detail-value highlight">5,000</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">오늘 방문자 수</div>
                            <div class="detail-value">${details.todayVisits || 0}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">누적 방문자 수</div>
                            <div class="detail-value">${details.totalVisits || 0}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">접속 로그</div>
                            <div class="detail-value"><div class="logs-scroll">${logsTable}</div></div>
                        </div>
                    </div>
                </div>
            `;
            // 모달 닫기 이벤트
            modal.querySelector('.modal-close').addEventListener('click', () => {
                modal.remove();
            });
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
            document.body.appendChild(modal);

            // 엑셀 다운로드 버튼 이벤트 바인딩 (원본 유지)
            setTimeout(async () => {
                const excelBtn = document.getElementById('modal-excel-download-btn');
                if (excelBtn) {
                    // 아이디 정보 가져오기
                    let username = '';
                    try {
                        const res = await fetch('/api/me', { credentials: 'include' });
                        if (res.ok) {
                            const data = await res.json();
                            if (data && data.success && data.user && data.user.username) {
                                username = data.user.username;
                            }
                        }
                    } catch {}
                    // 최신 방문일 구하기 (logs가 있으면 가장 최신, 없으면 생성일)
                    let latestDate = '';
                    if (details.logs && details.logs.length > 0) {
                        const sorted = details.logs.map(l => l.time).sort().reverse();
                        latestDate = sorted[0] || '';
                    } else {
                        latestDate = details.createdAt;
                    }
                    let dateStr = '';
                    if (latestDate) {
                        const d = new Date(latestDate);
                        dateStr = `${d.getFullYear().toString().slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
                    }
                    // 파일명: 아이디_단축코드_상세_날짜.xlsx
                    let fileName = `${username || 'user'}_${shortCode}_상세`;
                    if (dateStr) fileName += `_${dateStr}`;
                    fileName += '.xlsx';

                    excelBtn.onclick = async function() {
                        // longUrl을 전체 목록에서 찾아서 보장
                        let longUrlVal = details.longUrl;
                        if (!longUrlVal) {
                            try {
                                const baseUrl = window.location.origin;
                                const urlRes = await fetch(`${baseUrl}/urls`, { credentials: 'include' });
                                if (urlRes.ok) {
                                    const urls = await urlRes.json();
                                    const found = Array.isArray(urls) ? urls.find(u => u.shortCode === shortCode) : null;
                                    if (found && found.longUrl) longUrlVal = found.longUrl;
                                }
                            } catch {}
                        }
                        if (!longUrlVal) longUrlVal = '없음';
                        if (Array.isArray(longUrlVal)) longUrlVal = longUrlVal[0] || '없음';
                        if (typeof longUrlVal === 'string') longUrlVal = longUrlVal.replace(/\n/g, '').replace(/[\r\n]+/g, '');
                        // Short URL 보장
                        let shortUrlVal = details.shortUrl;
                        if (!shortUrlVal && shortCode) {
                            shortUrlVal = window.location.origin + '/' + shortCode;
                        }
                        // 1. 날짜별 방문수 집계 (내림차순)
                        const dateCount = {};
                        let total = 0;
                        if (details.logs && details.logs.length > 0) {
                            details.logs.forEach(log => {
                                const d = new Date(log.time);
                                const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                                dateCount[dateStr] = (dateCount[dateStr] || 0) + 1;
                                total++;
                            });
                        }
                        // 날짜 내림차순
                        const dateArr = Object.keys(dateCount).sort((a, b) => b.localeCompare(a));
                        // 첫 시트: 상세정보 (기본정보 가로, 날짜/방문수 세로가 총 방문수 오른쪽에)
                        const wsData = [
                            ['Short URL', 'Long URL', '생성일', '총 방문수', '날짜', '방문수'],
                            [shortUrlVal, longUrlVal, formattedDate, total, dateArr[0] || '', dateCount[dateArr[0]] || ''],
                        ];
                        for (let i = 1; i < dateArr.length; i++) {
                            wsData.push(['', '', '', '', dateArr[i], dateCount[dateArr[i]] || 0]);
                        }
                        // 두 번째 시트: 중복 IP 하나만, 접속시간 모두 줄바꿈, 총 접속수
                        const ipMap = {};
                        if (details.logs && details.logs.length > 0) {
                            details.logs.forEach(log => {
                                if (!ipMap[log.ip]) ipMap[log.ip] = [];
                                ipMap[log.ip].push(log.time);
                            });
                        }
                        const wsLogs = [
                            ['IP', '접속시간', 'IP별 총 접속수']
                        ];
                        Object.entries(ipMap).forEach(([ip, times]) => {
                            const sortedTimes = times.sort((a, b) => b.localeCompare(a));
                            const timeStr = sortedTimes.map(t => {
                                const d = new Date(t);
                                return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ` +
                                    `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                            }).join('\n');
                            wsLogs.push([ip, timeStr, times.length]);
                        });
                        // 워크북 생성
                        const wb = XLSX.utils.book_new();
                        const ws1 = XLSX.utils.aoa_to_sheet(wsData);
                        const ws2 = XLSX.utils.aoa_to_sheet(wsLogs);
                        // 시트 컬럼 너비 넓게 설정
                        ws1['!cols'] = [
                            { wch: 30 }, // Short URL
                            { wch: 50 }, // Long URL
                            { wch: 22 }, // 생성일
                            { wch: 12 }, // 총 방문수
                            ...dateArr.map(_ => ({ wch: 14 }))
                        ];
                        ws2['!cols'] = [
                            { wch: 18 }, // IP
                            { wch: 44 }, // 접속시간
                            { wch: 12 }  // IP별 총 접속수
                        ];
                        XLSX.utils.book_append_sheet(wb, ws1, '상세정보');
                        XLSX.utils.book_append_sheet(wb, ws2, '접속로그');
                        XLSX.writeFile(wb, fileName);
                    };
                }
            }, 0);
        })
        .catch(error => {
            console.error('Error:', error);
            alert('상세 정보를 불러오는 중 오류가 발생했습니다.');
        });
}

// 페이지 로드 시 URL 목록 로드
document.addEventListener('DOMContentLoaded', function() {
    // 로그인 상태 확인
    checkLoginStatus();
    
    // 전체 삭제 버튼 이벤트 리스너
    const deleteAllBtn = document.getElementById('deleteAllBtn');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', async function() {
            if (!confirm('모든 URL을 삭제하시겠습니까?')) return;
            try {
                const baseUrl = window.location.origin;
                const response = await fetch(`${baseUrl}/delete-all`, { 
                    method: 'DELETE',
                    credentials: 'include'
                });
                if (!response.ok) throw new Error('전체 삭제 실패');
                loadUrls();
                alert('모든 URL이 삭제되었습니다.');
            } catch (e) {
                alert('전체 삭제 중 오류가 발생했습니다.');
            }
        });
    }

    // 엑셀 다운로드 버튼 이벤트 리스너 (원본 유지)
    const downloadExcelBtn = document.getElementById('downloadExcelBtn');
    if (downloadExcelBtn) {
        downloadExcelBtn.addEventListener('click', async function() {
            const loadingModal = document.createElement('div');
            loadingModal.className = 'modal-overlay';
            loadingModal.innerHTML = `
                <div class="modal-content" style="text-align:center;padding:40px 30px;min-width:260px;">
                    <div style="font-size:20px;font-weight:bold;color:#1877f2;">엑셀 다운로드 중...</div>
                    <div style="margin-top:18px;color:#888;font-size:15px;">잠시만 기다려주세요</div>
                </div>
            `;
            document.body.appendChild(loadingModal);
            try {
                const baseUrl = window.location.origin;
                const urlRes = await fetch(`${baseUrl}/urls`, { credentials: 'include' });
                if (!urlRes.ok) throw new Error('URL 목록 조회 실패');
                const urls = await urlRes.json();
                if (!Array.isArray(urls) || urls.length === 0) {
                    alert('다운로드할 데이터가 없습니다.');
                    loadingModal.remove();
                    return;
                }
                const dataWithDetails = await Promise.all(urls.map(async url => {
                    try {
                        const detailRes = await fetch(`${baseUrl}/urls/${url.shortCode}/details`, { credentials: 'include' });
                        if (!detailRes.ok) throw new Error();
                        const details = await detailRes.json();
                        return { ...url, ip: details.ip || '', createdAt: details.createdAt || '', logs: details.logs || [] };
                    } catch {
                        return { ...url, ip: '', createdAt: '', logs: [] };
                    }
                }));
                const wsDataDashboard = [
                    ['Short URL', 'Long URL', '오늘 방문', '누적 방문', '생성일 / IP', '메모']
                ];
                const wsDataDetail = [
                    ['Short URL', 'Long URL', '생성일 / IP', '접속 IP', '접속시간']
                ];

                const dateSet = new Set();
                const urlDateCount = {};
                dataWithDetails.forEach(item => {
                    let formattedDate = '';
                    if (item.createdAt) {
                        const date = new Date(item.createdAt);
                        formattedDate = `${date.getFullYear()}. ${String(date.getMonth()+1).padStart(2,'0')}. ${String(date.getDate()).padStart(2,'0')}. ` +
                            `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}`;
                    }
                    let ipDisplay = item.ip || '';
                    if (ipDisplay && typeof ipDisplay === 'string') {
                        ipDisplay = '(' + ipDisplay.split(',')[0].trim() + ')';
                    }
                    const dateIp = `${formattedDate} ${ipDisplay}`;

                    // ✅ 대시보드 시트에 메모 포함
                    wsDataDashboard.push([
                        item.shortUrl,
                        item.longUrl,
                        item.todayVisits,
                        item.totalVisits,
                        dateIp,
                        item.memo || ''
                    ]);

                    if (item.logs && item.logs.length > 0) {
                        item.logs.forEach(log => {
                            const logIp = log.ip;
                            const logTime = new Date(log.time).toLocaleString('ko-KR', {
                                year: '2-digit', month: '2-digit', day: '2-digit',
                                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
                            });
                            wsDataDetail.push([ item.shortUrl, item.longUrl, dateIp, logIp, logTime ]);
                        });
                    } else {
                        wsDataDetail.push([ item.shortUrl, item.longUrl, dateIp, '-', '-' ]);
                    }

                    urlDateCount[item.shortUrl] = {};
                    if (item.logs && item.logs.length > 0) {
                        item.logs.forEach(log => {
                            const d = new Date(log.time);
                            const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                            dateSet.add(dateStr);
                            urlDateCount[item.shortUrl][dateStr] = (urlDateCount[item.shortUrl][dateStr] || 0) + 1;
                        });
                    }
                });

                const dateArr = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
                const wsDataDate = [['Short URL', 'Long URL', '총 조회수', ...dateArr]];
                dataWithDetails.forEach(item => {
                    const row = [item.shortUrl, item.longUrl];
                    let total = 0;
                    dateArr.forEach(date => { total += (urlDateCount[item.shortUrl][date] || 0); });
                    row.push(total);
                    dateArr.forEach(date => row.push(urlDateCount[item.shortUrl][date] || 0));
                    wsDataDate.push(row);
                });

                const wsDashboard = XLSX.utils.aoa_to_sheet(wsDataDashboard);
                wsDashboard['!cols'] = [
                    { wch: 30 }, { wch: 50 }, { wch: 10 }, { wch: 10 }, { wch: 32 }, { wch: 30 } // 마지막은 메모
                ];
                const wsDetail = XLSX.utils.aoa_to_sheet(wsDataDetail);
                wsDetail['!cols'] = [
                    { wch: 30 }, { wch: 50 }, { wch: 32 }, { wch: 40 }, { wch: 22 }
                ];
                const wsDate = XLSX.utils.aoa_to_sheet(wsDataDate);
                wsDate['!cols'] = [
                    { wch: 30 }, { wch: 50 }, { wch: 10 }, ...dateArr.map(_ => ({ wch: 12 }))
                ];

                // (간단 헤더 스타일 — 라이브러리 한계로 보장되지 않을 수 있음)
                [['A1','B1','C1','D1','E1','F1'], wsDashboard].forEach(() => {});
                [['A1','B1','C1','D1','E1'], wsDetail].forEach(() => {});
                // 날짜 시트 헤더는 생략

                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, wsDashboard, 'URL 대시보드');
                XLSX.utils.book_append_sheet(wb, wsDetail, '상세보기');
                XLSX.utils.book_append_sheet(wb, wsDate, '날짜별 방문자수');

                // 유저별 상세 시트 유지
                const userMap = {};
                dataWithDetails.forEach(item => {
                    if (item.logs && item.logs.length > 0) {
                        item.logs.forEach(log => {
                            const key = log.ip;
                            if (!userMap[key]) userMap[key] = { ip: log.ip, visits: [] };
                            userMap[key].visits.push(log.time);
                        });
                    }
                });
                const userSheet = [['IP', '유저 방문수', '방문 시각(시:분:초)']];
                Object.values(userMap).forEach(row => {
                    const visitTimes = row.visits.map(t => {
                        const d = new Date(t);
                        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' +
                            String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
                    }).join('\n');
                    userSheet.push([ row.ip, row.visits.length, visitTimes ]);
                });
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(userSheet), '유저별 상세');

                XLSX.writeFile(wb, 'url_list.xlsx');
            } catch (e) {
                console.error('엑셀 다운로드 중 JS 에러:', e);
                alert('엑셀 다운로드 중 오류가 발생했습니다.');
            } finally {
                const modal = document.querySelector('.modal-overlay');
                if (modal) modal.remove();
            }
        });
    }
});

// 로그인 상태 확인 함수
function checkLoginStatus() {
    const baseUrl = window.location.origin;
    
    console.log('로그인 상태 확인 중...');
    
    fetch(`${baseUrl}/api/me`, {
        method: 'GET',
        credentials: 'include', // 세션 쿠키 포함
        headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    })
    .then(response => {
        if (!response.ok) {
            if (response.status === 401) {
                console.error('인증되지 않음, 로그인 페이지로 이동');
                window.location.href = '/login';
                return null;
            }
            throw new Error('서버 응답 오류');
        }
        return response.json();
    })
    .then(data => {
        if (data && data.success && data.user) {
            console.log('인증된 사용자:', data.user.username);
            // 로그인 성공, URL 목록 로드
            loadUrls();
        } else if (data !== null) {
            console.error('사용자 정보가 없음, 로그인 페이지로 이동');
            window.location.href = '/login';
        }
    })
    .catch(error => {
        console.error('로그인 상태 확인 오류:', error);
        // 오류 발생 시도 로그인 페이지로 이동
        window.location.href = '/login';
    });
}

// 클립보드에 복사하는 함수
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        const notification = document.createElement('div');
        notification.style.position = 'fixed';
        notification.style.top = '90%';
        notification.style.left = '50%';
        notification.style.transform = 'translate(-50%, -50%)';
        notification.style.padding = '15px 25px';
        notification.style.backgroundColor = '#28a745';
        notification.style.color = 'white';
        notification.style.borderRadius = '4px';
        notification.style.zIndex = '1000';
        notification.style.textAlign = 'center';
        notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
        notification.textContent = 'URL이 복사되었습니다!';
        
        document.body.appendChild(notification);
        setTimeout(() => { notification.remove(); }, 1500);
    }).catch(err => {
        console.error('클립보드 복사 실패:', err);
        alert('URL 복사에 실패했습니다.');
    });
}
