document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('figure.highlight').forEach((figure) => {
    if (figure.querySelector('.copy-btn')) return;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.title = '复制';

    // 缩小后的复制图标（14*15）
    const copyIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" height="14" width="15" viewBox="0 0 24 24" fill="white">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 18H8V7h11v16z"/>
      </svg>
    `;

    // 成功后显示的勾（14*15）
    const checkIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" height="14" width="15" viewBox="0 0 24 24" fill="#ffffffff">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    `;

    copyBtn.innerHTML = copyIcon;

    // 按钮样式（浅灰底、缩小）
    Object.assign(copyBtn.style, {
      position: 'absolute',
      top: '8px',
      right: '8px',
      padding: '4px',
      background: '#6A5ACD', 
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      opacity: '0.85',
      zIndex: 1000,
      transition: 'opacity 0.2s ease',
      boxShadow: '0 2px 5px rgba(0, 0, 0, 0.15)'
    });

    copyBtn.addEventListener('mouseover', () => copyBtn.style.opacity = '1');
    copyBtn.addEventListener('mouseout', () => copyBtn.style.opacity = '0.85');

    copyBtn.addEventListener('click', () => {
      const code = figure.querySelector('td.code');
      const text = code ? code.innerText : '';
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = checkIcon;
        setTimeout(() => {
          copyBtn.innerHTML = copyIcon;
        }, 1000);
      });
    });

    figure.style.position = 'relative';
    figure.appendChild(copyBtn);
  });
});
