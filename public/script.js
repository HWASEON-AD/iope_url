// DOM 요소
const longUrlInput = document.getElementById('longUrl');
const shortenBtn = document.getElementById('shortenBtn');
const resultBox = document.getElementById('resultBox');
const shortUrlSpan = document.getElementById('shortUrl');
const copyBtn = document.getElementById('copyBtn');

// API 기본 URL 설정 - 현재 도메인 기반으로 자동 설정
const API_BASE_URL = window.location.origin;

// 상태
let currentShortCode = '';

// 페이지 로드 시 세션 상태 체크
document.addEventListener('DOMContentLoaded', function() {
  console.log('페이지 로드: 세션 상태 확인 중');
  
  // 로그인 상태 확인
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
});

// URL 단축
shortenBtn.addEventListener('click', async function(e) {
  e.preventDefault();
  const urlInput = document.getElementById('longUrl');
  if (!urlInput) {
    alert('URL 입력창을 찾을 수 없습니다.');
    return;
  }
  let longUrl = urlInput.value.trim();
  if (!longUrl) {
    alert('URL을 입력하세요');
    return;
  }
  
  // http/https 없으면 자동으로 붙이기
  if (!/^https?:\/\//i.test(longUrl)) {
    longUrl = 'https://' + longUrl;
  }
  
  // URL 유효성 검사 강화
  if (!isValidUrl(longUrl)) {
    alert('유효한 URL을 입력하세요');
    return;
  }
  
  // 객체면 문자열로 변환
  if (typeof longUrl !== 'string') {
    longUrl = String(longUrl);
  }
  
  // 로그인 상태 확인
  console.log('URL 단축 전 세션 쿠키 확인');
  
  try {
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

    // 사용자에게는 hwaseon-url 형식으로 보여줌
    shortUrlSpan.textContent = data.shortUrl;
    // 실제 리다이렉션은 redirectUrl을 사용
    shortUrlSpan.dataset.redirectUrl = data.redirectUrl;
    resultBox.style.display = 'flex';
    
    // 단축 성공 메시지 표시
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = 'URL이 단축되었습니다!';
    document.body.appendChild(notification);
    
    // 2초 후 메시지 제거
    setTimeout(() => {
      notification.remove();
    }, 2000);
  } catch (err) {
    console.error('Error:', err);
    alert('URL 단축 실패: ' + err.message);
  }
});

// URL 복사
copyBtn.addEventListener('click', function(e) {
  e.preventDefault();
  
  const text = shortUrlSpan.textContent;
  navigator.clipboard.writeText(text)
    .then(() => {
      // 복사 성공 메시지 표시
      const notification = document.createElement('div');
      notification.className = 'copy-notification';
      notification.textContent = 'URL이 복사되었습니다!';
      document.body.appendChild(notification);
      
      // 2초 후 메시지 제거
      setTimeout(() => {
        notification.remove();
      }, 2000);
    })
    .catch(err => {
      console.error('복사 실패:', err);
      const notification = document.createElement('div');
      notification.className = 'copy-notification error';
      notification.textContent = 'URL 복사에 실패했습니다.';
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.remove();
      }, 2000);
    });
});

// Enter 키로 단축하기
longUrlInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    shortenBtn.click();
  }
});

// 폼 제출 방지
document.addEventListener('submit', function(e) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
});

// 특정 링크를 제외한 모든 링크 클릭 이벤트 처리
document.addEventListener('click', function(e) {
  // 로그인, 대시보드, 다중 URL 단축 관련 링크와 버튼은 예외 처리
  const isExcluded = 
    e.target.classList.contains('login-btn') || 
    e.target.id === 'loginBtn' || 
    e.target.id === 'logoutBtn' || 
    e.target.classList.contains('dashboard-btn') || 
    e.target.classList.contains('multiple-btn') ||
    e.target.classList.contains('login-redirect-btn') ||
    (e.target.tagName === 'A' && (
      e.target.href.includes('/login') || 
      e.target.href.includes('/dashboard') || 
      e.target.href.includes('/multiple') ||
      e.target.href.includes('/admin')
    ));
  
  if (e.target.tagName === 'A' && !isExcluded) {
    e.preventDefault();
    e.stopPropagation();
  }
});

// F5 키 방지
document.addEventListener('keydown', function(e) {
  if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
});

// 마우스 우클릭 메뉴 방지
document.addEventListener('contextmenu', function(e) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
});

// 버튼 클릭 효과 함수
function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 2000);
}

// URL 입력창 복사 기능
document.getElementById('longUrl').addEventListener('click', function() {
    this.select();
    document.execCommand('copy');
});

// URL 유효성 검사 함수 개선
function isValidUrl(url) {
    try {
        const urlObj = new URL(url);
        // 도메인 이름에 점(.)이 포함되어 있고, 최소 길이 조건을 만족하는지 확인
        return urlObj.hostname.includes('.') && urlObj.hostname.length >= 3;
    } catch (e) {
        return false;
    }
}

// 대시보드 버튼 클릭 이벤트
document.querySelector('.dashboard-btn').addEventListener('click', function(e) {
    e.preventDefault();
    // 로그인 상태 확인
    fetch('/api/me', {
        credentials: 'include' // 세션 쿠키 포함
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // 이미 로그인 된 경우 대시보드로 이동
                window.location.href = '/dashboard';
            } else {
                // 로그인 안된 경우 알림 메시지 표시
                showLoginRequiredModal();
            }
        })
        .catch(error => {
            console.error('Error checking login status:', error);
            // 오류 발생 시에도 알림 메시지 표시
            showLoginRequiredModal();
        });
});

// 로그인 필요 알림 모달 표시
function showLoginRequiredModal() {
    // 기존 모달이 있으면 제거
    const existingModal = document.querySelector('.modal-overlay');
    if (existingModal) {
        existingModal.remove();
    }

    // 모달 생성
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="width: 380px; text-align: center; padding: 30px 20px;">
            <div class="modal-header" style="margin-bottom: 15px;">
                <div class="modal-title" style="font-size: 20px; font-weight: bold; color: #4c6ef5;">로그인 필요</div>
            </div>
            <div style="margin: 20px 0; line-height: 1.6;">
                <p>대시보드 기능은 회원에 한하여 가능합니다.</p>
                <p>로그인 후, 만든 URL에 한해서 기능이 제공됩니다.</p>
            </div>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 25px;">
                <button class="modal-close-btn" style="background-color: #868e96; color: white; border: none; border-radius: 5px; padding: 10px 20px; cursor: pointer;">닫기</button>
            </div>
        </div>
    `;

    // 모달 스타일
    const style = document.createElement('style');
    style.textContent = `
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .modal-content {
            background-color: white;
            border-radius: 10px;
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.2);
        }
        .modal-close-btn:hover {
            opacity: 0.9;
        }
    `;
    document.head.appendChild(style);

    // 이벤트 리스너 추가
    document.body.appendChild(modal);
    modal.querySelector('.modal-close-btn').addEventListener('click', function() {
        modal.remove();
    });
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// 다중 URL 단축 버튼 클릭 이벤트
document.querySelector('.multiple-btn').addEventListener('click', function() {
    window.location.href = '/multiple';
});

// 버튼 hover 효과 함수
function addHoverEffect(button) {
    button.addEventListener('mouseover', function() {
        this.style.transform = 'scale(1.05)';
        this.style.transition = 'transform 0.2s ease';
    });

    button.addEventListener('mouseout', function() {
        this.style.transform = 'scale(1)';
    });
}

// 모든 버튼에 hover 효과 적용
document.addEventListener('DOMContentLoaded', function() {
    // 단축 버튼
    const shortenBtn = document.getElementById('shortenBtn');
    addHoverEffect(shortenBtn);

    // 복사 버튼 (동적으로 생성되므로 이벤트 위임 사용)
    document.addEventListener('click', function(e) {
        if (e.target && e.target.id === 'copyBtn') {
            addHoverEffect(e.target);
        }
    });

    // 대시보드 버튼
    const dashboardBtn = document.querySelector('.dashboard-btn');
    addHoverEffect(dashboardBtn);

    // 다중 URL 단축 버튼
    const multipleBtn = document.querySelector('.multiple-btn');
    addHoverEffect(multipleBtn);
}); 