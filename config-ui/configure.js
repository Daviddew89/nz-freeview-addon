// NZ Freeview Config UI JS (restored) 
const API_URL = window.location.origin;
let channels = [];
let selected = [];
let defaultOrder = [];
let search = '';

// Public CORS proxies for resilient fetching
const PROXY_URLS = [
    'https://corsproxy.io/?',
    'https://cors.eu.org/',
    'https://thingproxy.freeboard.io/fetch/',
];

// Resilient fetch function (similar to the working example)
async function resilientFetch(url, options = {}) {
    let lastError = null;

    // Try direct fetch first
    try {
        const response = await fetch(url, options);
        if (response.ok) {
            console.log(`[resilientFetch] Direct connection success for ${url}`);
            return response;
        }
    } catch (error) {
        console.log(`[resilientFetch] Direct connection failed for ${url}:`, error.message);
        lastError = error;
    }

    // Try public proxies
    for (const proxy of PROXY_URLS) {
        try {
            const proxyUrl = `${proxy}${url}`;
            console.log(`[resilientFetch] Trying proxy: ${proxy}`);
            const response = await fetch(proxyUrl, options);
            if (response.ok) {
                console.log(`[resilientFetch] Proxy success: ${proxy}`);
                return response;
            }
        } catch (error) {
            console.log(`[resilientFetch] Proxy failed: ${proxy}`, error.message);
            lastError = error;
        }
    }

    // If all attempts fail, throw the last error
    throw lastError || new Error(`Failed to fetch ${url} after trying all proxies and direct connection.`);
}

const channelList = document.getElementById('channelList');
const searchInput = document.getElementById('search');
const selectAllBtn = document.getElementById('selectAll');
const deselectAllBtn = document.getElementById('deselectAll');
const resetBtn = document.getElementById('reset');
const manifestUrlSpan = document.getElementById('manifestUrl');
const installLink = document.getElementById('installLink');
const errorDiv = document.getElementById('error');
const toggleManifestUrlBtn = document.getElementById('toggleManifestUrl');

// Add debugging
console.log('Config UI loaded. API_URL:', API_URL);

function base64Encode(obj) {
  return btoa(JSON.stringify(obj));
}

function renderChannels() {
  channelList.innerHTML = '';
  const filtered = channels.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  // Selected channels in order
  const selectedChannels = filtered.filter(c => selected.includes(c.id));
  selectedChannels.sort((a, b) => selected.indexOf(a.id) - selected.indexOf(b.id));
  // Unselected channels
  const unselectedChannels = filtered.filter(c => !selected.includes(c.id));
  let dragSrcIdx = null;
  let dropTargetIdx = null;

  // Helper to render drop indicator
  function renderDropIndicator(idx) {
    const indicator = document.createElement('li');
    indicator.className = 'drop-indicator';
    indicator.innerHTML = '<div></div>';
    indicator.dataset.dropIdx = idx;
    return indicator;
  }

  // Render selected
  selectedChannels.forEach((channel, idx) => {
    // Drop indicator before each item
    channelList.appendChild(renderDropIndicator(idx));
    const li = document.createElement('li');
    li.className = 'selected';
    li.draggable = true;
    li.ondragstart = e => {
      dragSrcIdx = idx;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    };
    li.ondragend = e => {
      dragSrcIdx = null;
      li.classList.remove('dragging');
      // Remove all drop indicators
      document.querySelectorAll('.drop-indicator').forEach(el => el.classList.remove('active'));
    };
    li.ondragover = e => {
      e.preventDefault();
      // Highlight the drop indicator before this item
      document.querySelectorAll('.drop-indicator').forEach((el, i) => {
        el.classList.toggle('active', i === idx);
      });
      dropTargetIdx = idx;
    };
    li.ondrop = e => {
      e.preventDefault();
      if (dragSrcIdx !== null && dragSrcIdx !== dropTargetIdx) {
        const newSelected = [...selected];
        const [moved] = newSelected.splice(dragSrcIdx, 1);
        newSelected.splice(dropTargetIdx, 0, moved);
        selected = newSelected;
        renderChannels();
        updateManifestUrl();
      }
    };
    li.innerHTML = `<label><input type="checkbox" checked> <img class="channel-logo" src="${channel.logo || channel.poster}" alt="logo"> ${channel.name}</label>`;
    li.querySelector('input').onchange = () => toggleChannel(channel.id);
    channelList.appendChild(li);
  });
  // Drop indicator after last item
  if (selectedChannels.length) channelList.appendChild(renderDropIndicator(selectedChannels.length));
  // Divider
  if (unselectedChannels.length && selectedChannels.length) {
    const div = document.createElement('li');
    div.className = 'divider';
    channelList.appendChild(div);
  }
  // Render unselected
  unselectedChannels.forEach(channel => {
    const li = document.createElement('li');
    li.innerHTML = `<label><input type="checkbox"> <img class="channel-logo" src="${channel.logo || channel.poster}" alt="logo"> ${channel.name}</label>`;
    li.querySelector('input').onchange = () => toggleChannel(channel.id);
    channelList.appendChild(li);
  });
  // Drop logic for after last item
  document.querySelectorAll('.drop-indicator').forEach((el, idx) => {
    el.ondragover = e => {
      e.preventDefault();
      document.querySelectorAll('.drop-indicator').forEach((el2, i) => {
        el2.classList.toggle('active', i === idx);
      });
      dropTargetIdx = idx;
    };
    el.ondrop = e => {
      e.preventDefault();
      if (dragSrcIdx !== null && dragSrcIdx !== dropTargetIdx) {
        const newSelected = [...selected];
        const [moved] = newSelected.splice(dragSrcIdx, 1);
        newSelected.splice(dropTargetIdx, 0, moved);
        selected = newSelected;
        renderChannels();
        updateManifestUrl();
      }
    };
  });
}

function toggleChannel(id) {
  if (selected.includes(id)) {
    selected = selected.filter(i => i !== id);
  } else {
    selected.push(id);
  }
  renderChannels();
  updateManifestUrl();
}

function updateManifestUrl() {
  // Pass channel selection and order via the standard 'config' parameter in the manifest URL.
  const config = { channels: selected };
  const b64Config = base64Encode(config);
  const manifestUrl = `${API_URL}/manifest.json?config=${b64Config}`;
  
  manifestUrlSpan.textContent = manifestUrl;
  installLink.href = `stremio://${window.location.host}/manifest.json?config=${b64Config}`;
  installLink.setAttribute('aria-disabled', selected.length ? 'false' : 'true');
}

function handleSelectAll() {
  selected = channels.map(c => c.id);
  renderChannels();
  updateManifestUrl();
}
function handleDeselectAll() {
  selected = [];
  renderChannels();
  updateManifestUrl();
}
function handleReset() {
  selected = [...defaultOrder];
  search = '';
  searchInput.value = '';
  renderChannels();
  updateManifestUrl();
}

searchInput.oninput = e => {
  search = e.target.value;
  renderChannels();
};
selectAllBtn.onclick = handleSelectAll;
deselectAllBtn.onclick = handleDeselectAll;
resetBtn.onclick = handleReset;

toggleManifestUrlBtn.onclick = () => {
  if (manifestUrlSpan.style.display === 'none' || !manifestUrlSpan.style.display) {
    manifestUrlSpan.style.display = '';
    toggleManifestUrlBtn.textContent = 'Hide Manifest URL';
  } else {
    manifestUrlSpan.style.display = 'none';
    toggleManifestUrlBtn.textContent = 'Show Manifest URL';
  }
};

function showError(msg) {
  console.error('Config UI Error:', msg);
  errorDiv.textContent = msg;
  errorDiv.style.display = '';
}
function hideError() {
  errorDiv.style.display = 'none';
}

console.log('Fetching channels from:', `${API_URL}/catalog/tv/nzfreeview.json`);

resilientFetch(`${API_URL}/catalog/tv/nzfreeview.json`)
  .then(res => {
    console.log('Fetch response status:', res.status);
    if (!res.ok) throw new Error(`Failed to fetch channel list: ${res.status} ${res.statusText}`);
    return res.json();
  })
  .then(data => {
    console.log('Received data:', data);
    console.log('Number of metas:', data.metas ? data.metas.length : 0);
    channels = (data.metas || []).map(c => ({
      id: c.id.replace('nzfreeview-', ''),
      name: c.name,
      logo: c.logo,
      poster: c.poster
    }));
    console.log('Processed channels:', channels.length);
    selected = channels.map(c => c.id);
    defaultOrder = [...selected];
    renderChannels();
    updateManifestUrl();
    hideError();
  })
  .catch((error) => {
    console.error('Error fetching channels:', error);
    showError(`Could not load channel list: ${error.message}`);
  });