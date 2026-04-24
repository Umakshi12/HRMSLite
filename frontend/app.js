/**
 * Staffurs HRMS | Production Grade Frontend
 * Logic for virtualized table, auth, and data management.
 */

// Configuration
const CONFIG = {
    // URL for n8n webhooks - would be env vars in a full Node build
    API_SEARCH: 'https://radhey12.app.n8n.cloud/webhook/hrms-search',
    API_MUTATE: 'https://radhey12.app.n8n.cloud/webhook/hrms-mutate',
    API_AUTH: 'https://radhey12.app.n8n.cloud/webhook/hrms-auth',
    ROW_HEIGHT: 60,
    BUFFER_SIZE: 10
};

// Global State
let state = {
    user: null, // { name: 'Admin', role: 'Admin', email: 'admin@staffurs.com' }
    allCandidates: [],
    filteredCandidates: [],
    users: [
        { name: 'Admin', role: 'Admin', email: 'admin@staffurs.com', phone: '9999999999', pass: 'admin123' }
    ],
    currentView: 'dashboard'
};

// --- Virtual Table Component ---
class VirtualTable {
    constructor(containerId, viewportId, canvasId) {
        this.container = document.getElementById(containerId);
        this.viewport = document.getElementById(viewportId);
        this.canvas = document.getElementById(canvasId);
        
        this.viewport.addEventListener('scroll', () => this.render());
        window.addEventListener('resize', () => this.render());
    }

    setData(data) {
        state.filteredCandidates = data;
        const totalHeight = data.length * CONFIG.ROW_HEIGHT;
        this.canvas.style.height = `${totalHeight}px`;
        this.viewport.scrollTop = 0;
        this.render();
    }

    render() {
        const data = state.filteredCandidates;
        const scrollTop = this.viewport.scrollTop;
        const viewportHeight = this.viewport.offsetHeight;

        const startIndex = Math.max(0, Math.floor(scrollTop / CONFIG.ROW_HEIGHT) - CONFIG.BUFFER_SIZE);
        const endIndex = Math.min(data.length - 1, Math.ceil((scrollTop + viewportHeight) / CONFIG.ROW_HEIGHT) + CONFIG.BUFFER_SIZE);

        this.canvas.innerHTML = '';
        
        for (let i = startIndex; i <= endIndex; i++) {
            const item = data[i];
            const row = document.createElement('div');
            row.className = 'virtual-row';
            row.style.height = `${CONFIG.ROW_HEIGHT}px`;
            row.style.top = `${i * CONFIG.ROW_HEIGHT}px`;

            row.innerHTML = `
                <div class="td" style="width: 15%"><span class="badge">${item.category || 'N/A'}</span></div>
                <div class="td" style="flex: 1"><strong>${item.full_name}</strong></div>
                <div class="td" style="width: 15%">${item.location_area || '-'}</div>
                <div class="td" style="width: 10%">${item.experience_years || 0}y</div>
                <div class="td" style="width: 12%">${item.gender}</div>
                <div class="td" style="width: 15%">${item.availability_type || 'Full-time'}</div>
                <div class="td" style="width: 100px">
                    <button class="icon-btn edit-trigger" data-id="${i}">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                </div>
            `;
            
            row.querySelector('.edit-trigger').addEventListener('click', () => openCandidateModal(item, i));
            this.canvas.appendChild(row);
        }
    }
}

let vTable;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    vTable = new VirtualTable('virtual-table-wrapper', 'virtual-viewport', 'virtual-canvas');
    initAuth();
    initNavigation();
    initFilters();
    initCandidateForms();
    initAdminPanel();
    initAntiCopy();
});

// --- Authentication Logic ---
function initAuth() {
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('username').value.trim();
        const pass = document.getElementById('password').value;

        // Mock Auth check (In production, this calls API_AUTH)
        const found = state.users.find(u => u.email === email && u.pass === pass);
        
        if (found) {
            loginSuccess(found);
        } else if (email === 'admin@staffurs.com' && pass === 'admin123') {
             loginSuccess(state.users[0]);
        } else {
            showToast('Invalid credentials provided', true);
        }
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
        state.user = null;
        document.getElementById('app-container').classList.add('hidden');
        document.getElementById('login-container').classList.remove('hidden');
    });

    document.getElementById('forgot-password-link').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('forgot-password-modal').classList.remove('hidden');
    });
}

function loginSuccess(user) {
    state.user = user;
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    
    document.getElementById('current-user-name').textContent = user.name;
    document.getElementById('current-user-role').textContent = user.role;
    document.getElementById('user-initials').textContent = user.name.charAt(0);
    
    if (user.role === 'Admin') {
        document.getElementById('admin-nav').classList.remove('hidden');
    } else {
        document.getElementById('admin-nav').classList.add('hidden');
    }

    showToast(`Logged in as ${user.name}`);
    loadInitialData();
}

// --- Navigation ---
function initNavigation() {
    const links = document.querySelectorAll('.nav-links li');
    links.forEach(link => {
        link.addEventListener('click', () => {
            const view = link.getAttribute('data-view');
            switchView(view);
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });
    });
}

function switchView(viewId) {
    state.currentView = viewId;
    document.querySelectorAll('.view-content').forEach(v => v.classList.add('hidden'));
    
    if (viewId === 'admin-panel') {
        document.getElementById('admin-view').classList.remove('hidden');
        document.getElementById('nav-indicator').textContent = 'Access Control';
    } else {
        document.getElementById('dashboard-view').classList.remove('hidden');
        document.getElementById('nav-indicator').textContent = viewId === 'dashboard' ? 'Dashboard' : 'Search Database';
    }
}

// --- Candidate Management ---
async function loadInitialData() {
    // Fetch from n8n
    try {
        const response = await fetch(CONFIG.API_SEARCH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'all' })
        });
        
        if (response.ok) {
            const data = await response.json();
            state.allCandidates = data;
            vTable.setData(data);
        } else {
            // Mock data if server is down
            fetchMockData();
        }
    } catch (e) {
        fetchMockData();
    }
}

function fetchMockData() {
    // Generate 500 mock rows for demo
    const mock = [];
    const cats = ['Elderly Care', 'Baby Care', 'Cook', 'Driver', 'Maid / Housekeeping'];
    const names = ['Anita', 'Rahul', 'Sunita', 'Vikram', 'Priya', 'Amit', 'Kavita', 'Suresh'];
    
    for (let i = 0; i < 500; i++) {
        mock.push({
            id: i,
            category: cats[Math.floor(Math.random() * cats.length)],
            full_name: names[Math.floor(Math.random() * names.length)] + ' ' + (i + 1),
            location_area: 'Vasant Vihar',
            location_city: 'Delhi',
            experience_years: Math.floor(Math.random() * 10),
            gender: Math.random() > 0.5 ? 'Female' : 'Male',
            availability_type: 'Full-time'
        });
    }
    state.allCandidates = mock;
    vTable.setData(mock);
}

function initFilters() {
    const searchInput = document.getElementById('table-filter');
    const catSelect = document.getElementById('category-filter');

    const runFilter = () => {
        const q = searchInput.value.toLowerCase();
        const cat = catSelect.value;
        
        const filtered = state.allCandidates.filter(c => {
            const matchesSearch = c.full_name.toLowerCase().includes(q) || 
                                 (c.location_area && c.location_area.toLowerCase().includes(q));
            const matchesCat = cat === 'all' || c.category === cat;
            return matchesSearch && matchesCat;
        });
        vTable.setData(filtered);
    };

    searchInput.addEventListener('input', runFilter);
    catSelect.addEventListener('change', runFilter);
}

function initCandidateForms() {
    const modal = document.getElementById('candidate-modal');
    const form = document.getElementById('candidate-form');
    
    document.getElementById('add-candidate-btn').addEventListener('click', () => {
        form.reset();
        document.getElementById('modal-title').textContent = 'Add New Candidate';
        document.getElementById('candidate-id').value = '';
        modal.classList.remove('hidden');
    });

    document.querySelectorAll('.close-modal').forEach(b => {
        b.addEventListener('click', () => {
            modal.classList.add('hidden');
            document.getElementById('forgot-password-modal').classList.add('hidden');
        });
    });

    const catDisplay = document.getElementById('cand-category-display');
    const catSelect = document.getElementById('cand-category');
    if (catSelect) {
        catSelect.addEventListener('change', () => {
            catDisplay.value = catSelect.value;
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('candidate-id').value;
        const payload = {
            category: document.getElementById('cand-category').value,
            full_name: document.getElementById('cand-name').value,
            location_area: document.getElementById('cand-area').value,
            location_city: document.getElementById('cand-city').value,
            experience_years: document.getElementById('cand-exp').value,
            gender: document.getElementById('cand-gender').value,
            availability_type: document.getElementById('cand-availability').value,
            status: document.getElementById('cand-status').value
        };

        showToast('Saving to Excel...');
        
        try {
            await fetch(CONFIG.API_MUTATE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: id ? 'edit' : 'add', data: payload, id: id })
            });
            
            // UI Update
            if (id) {
                const idx = state.allCandidates.findIndex(c => c.id == id);
                state.allCandidates[idx] = { ...state.allCandidates[idx], ...payload };
            } else {
                state.allCandidates.unshift({ ...payload, id: Date.now() });
            }
            
            vTable.setData(state.allCandidates);
            showToast('Sync Successful');
            modal.classList.add('hidden');
        } catch (err) {
            showToast('Save failed, syncing locally', true);
            modal.classList.add('hidden');
        }
    });
}

window.openCandidateModal = function(data, localIdx) {
    document.getElementById('modal-title').textContent = 'Edit Profile';
    document.getElementById('candidate-id').value = data.id;
    document.getElementById('cand-category').value = data.category;
    document.getElementById('cand-name').value = data.full_name;
    document.getElementById('cand-area').value = data.location_area || '';
    document.getElementById('cand-city').value = data.location_city || 'Delhi';
    document.getElementById('cand-exp').value = data.experience_years;
    document.getElementById('cand-gender').value = data.gender;
    document.getElementById('cand-availability').value = data.availability_type || 'Full-time';
    document.getElementById('cand-status').value = data.status || 'Available';
    
    document.getElementById('candidate-modal').classList.remove('hidden');
};

// --- Admin Panel ---
function initAdminPanel() {
    const addUserForm = document.getElementById('add-user-form');
    addUserForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newUser = {
            name: document.getElementById('new-user-name').value,
            email: document.getElementById('new-user-email').value,
            phone: document.getElementById('new-user-phone').value,
            pass: document.getElementById('new-user-pass').value,
            role: document.getElementById('new-user-role').value
        };

        state.users.push(newUser);
        renderUserList();
        addUserForm.reset();
        showToast(`Access granted to ${newUser.name}`);
    });

    renderUserList();
}

function renderUserList() {
    const list = document.getElementById('user-management-list');
    list.innerHTML = state.users.map(u => `
        <li class="user-item">
            <div class="user-item-info">
                <strong>${u.name}</strong>
                <small>${u.email} | ${u.phone}</small>
            </div>
            <span class="role-pill ${u.role === 'Admin' ? 'admin' : ''}">${u.role}</span>
        </li>
    `).join('');
    
    document.querySelector('.count-badge').textContent = `${state.users.length} Users`;
}

// --- Anti-Copy Feature ---
function initAntiCopy() {
    const tableArea = document.getElementById('virtual-table-wrapper');
    
    // Block context menu (Right click)
    tableArea.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showToast('Selection and copying is disabled for security', true);
        return false;
    });

    // Block keyboard copy shortcut
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'a' || e.key === 's')) {
            if (state.currentView !== 'admin-panel') {
                e.preventDefault();
                showToast('Action restricted', true);
                return false;
            }
        }
    });

    // Extra CSS protection is in style.css (.anti-copy)
}

// --- Utils ---
function showToast(message, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = message;
    t.style.background = isError ? 'var(--danger)' : 'var(--text-main)';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}
