document.addEventListener('DOMContentLoaded', () => {
    const API_URL = window.location.origin;
    
    let allChannels = [];
    let selectedChannelIds = [];
    let sortable;

    // DOM Elements
    const channelListEl = document.getElementById('channelList');
    const searchInput = document.getElementById('search');
    const selectAllBtn = document.getElementById('selectAll');
    const deselectAllBtn = document.getElementById('deselectAll');
    const resetBtn = document.getElementById('reset');
    const manifestUrlSpan = document.getElementById('manifestUrl');
    const installLink = document.getElementById('installLink');
    const errorDiv = document.getElementById('error');
    const toggleManifestUrlBtn = document.getElementById('toggleManifestUrl');

    // --- Core Functions ---
    
    /**
     * Encodes an object into a Base64 string for URL configuration.
     */
    function base64Encode(obj) {
        return btoa(JSON.stringify(obj));
    }

    /**
     * Updates the manifest URL and install link based on the current configuration.
     */
    function updateManifestUrl() {
        const config = { channels: selectedChannelIds };
        const b64Config = base64Encode(config);
        const manifestUrl = `${API_URL}/manifest.json?config=${b64Config}`;
        
        manifestUrlSpan.textContent = manifestUrl;
        installLink.href = `stremio://${window.location.host}/manifest.json?config=${b64Config}`;
        installLink.setAttribute('aria-disabled', selectedChannelIds.length === 0 ? 'true' : 'false');
    }

    /**
     * Creates a channel list item element.
     */
    function createChannelElement(channel) {
        const li = document.createElement('li');
        li.className = 'channel-item';
        li.dataset.id = channel.id;
        li.innerHTML = `
            <label>
                <input type="checkbox" ${channel.selected ? 'checked' : ''}>
                <img class="channel-logo" src="${channel.logo || channel.poster}" alt="logo">
                <span>${channel.name}</span>
            </label>
        `;
        li.querySelector('input').addEventListener('change', () => toggleChannelSelection(channel.id));
        return li;
    }

    /**
     * Renders the channel list based on the current state.
     */
    function renderChannels() {
        const searchTerm = searchInput.value.toLowerCase();
        
        // Filter and sort channels
        const visibleChannels = allChannels.filter(c => c.name.toLowerCase().includes(searchTerm));
        const selectedChannels = visibleChannels.filter(c => selectedChannelIds.includes(c.id)).map(c => ({...c, selected: true}));
        const unselectedChannels = visibleChannels.filter(c => !selectedChannelIds.includes(c.id)).map(c => ({...c, selected: false}));
        
        // Sort selected channels based on the master order
        selectedChannels.sort((a, b) => selectedChannelIds.indexOf(a.id) - selectedChannelIds.indexOf(b.id));

        // Clear the list and re-render
        channelListEl.innerHTML = '';
        const fragment = document.createDocumentFragment();
        [...selectedChannels, ...unselectedChannels].forEach(channel => {
            fragment.appendChild(createChannelElement(channel));
        });
        channelListEl.appendChild(fragment);

        // Update SortableJS
        if (sortable) {
            sortable.option("group", { name: "channels", put: false });
        }
    }

    /**
     * Toggles the selection state of a channel.
     */
    function toggleChannelSelection(id) {
        const index = selectedChannelIds.indexOf(id);
        if (index > -1) {
            selectedChannelIds.splice(index, 1);
        } else {
            selectedChannelIds.push(id);
        }
        renderChannels();
        updateManifestUrl();
    }
    
    // --- Event Handlers ---

    function handleSelectAll() {
        selectedChannelIds = allChannels.map(c => c.id);
        renderChannels();
        updateManifestUrl();
    }

    function handleDeselectAll() {
        selectedChannelIds = [];
        renderChannels();
        updateManifestUrl();
    }

    function handleReset() {
        selectedChannelIds = allChannels.map(c => c.id);
        searchInput.value = '';
        renderChannels();
        updateManifestUrl();
    }
    
    // --- Initialization ---

    function initSortable() {
        sortable = new Sortable(channelListEl, {
            animation: 150,
            ghostClass: 'dragging',
            onEnd: (evt) => {
                // Update the selectedChannelIds array based on the new DOM order
                const newOrder = Array.from(evt.to.children)
                    .map(el => el.dataset.id)
                    .filter(id => selectedChannelIds.includes(id));
                selectedChannelIds = newOrder;
                updateManifestUrl();
            }
        });
    }

    function showError(message) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    function hideError() {
        errorDiv.style.display = 'none';
    }

    // Fetch initial channel data
    fetch(`${API_URL}/catalog/tv/nzfreeview.json`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            allChannels = (data.metas || []).map(c => ({
                id: c.id.replace('nzfreeview-', ''),
                name: c.name,
                logo: c.logo,
                poster: c.poster,
            }));
            
            // Initially, all channels are selected in their default order
            selectedChannelIds = allChannels.map(c => c.id);
            
            renderChannels();
            updateManifestUrl();
            initSortable();
            hideError();
        })
        .catch(error => {
            console.error('Error fetching channel list:', error);
            showError(`Could not load channel list. Please ensure the addon is running. Error: ${error.message}`);
        });

    // --- Event Listeners ---
    searchInput.addEventListener('input', renderChannels);
    selectAllBtn.addEventListener('click', handleSelectAll);
    deselectAllBtn.addEventListener('click', handleDeselectAll);
    resetBtn.addEventListener('click', handleReset);
    toggleManifestUrlBtn.addEventListener('click', () => {
        const isHidden = manifestUrlSpan.style.display === 'none';
        manifestUrlSpan.style.display = isHidden ? '' : 'none';
        toggleManifestUrlBtn.textContent = isHidden ? 'Hide Manifest URL' : 'Show Manifest URL';
    });
});
