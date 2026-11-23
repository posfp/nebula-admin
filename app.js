// ====================================================================
// NEBULA POS - CLOUD ADMIN CONTROLLER (PWA)
// Real-time synchronization with Supabase REST API
// ====================================================================

const DEFAULT_CONFIG = {
  apiUrl: 'https://dakzajlrtekdqyflpfyx.supabase.co/rest/v1',
  apiKey: 'sb_publishable_iFRaYHJGGTPQb75Lu-KCFQ_atj6zVHv',
  storeId: 'local_principal'
};

let config = { ...DEFAULT_CONFIG };
let currentTab = 'sales';
let currentFilter = 'today';
let filterStartDate = null;
let filterEndDate = null;
let physicalInventoryItems = [];
let allProducts = [];
let autoRefreshTimer = null;

// Currency Formatter
const formatCurrency = (val) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(val || 0);
};

// Date Formatter
const formatDate = (isoString) => {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

// API Fetch Helper
async function apiRequest(endpoint, options = {}) {
  const url = `${config.apiUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
  const headers = {
    'apikey': config.apiKey,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  // Only add Bearer header if key is a traditional JWT
  if (config.apiKey && !config.apiKey.startsWith('sb_')) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await res.json();
  }
  return null;
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  initServiceWorker();
  initEvents();
  initDateFilters();
  switchTab('sales');
  refreshAllData();

  // Auto refresh every 30 seconds
  autoRefreshTimer = setInterval(() => {
    refreshAllData(true);
  }, 30000);
});

// Load Config from localStorage
function loadConfig() {
  const saved = localStorage.getItem('nebula_cloud_config');
  if (saved) {
    try {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) {
      config = { ...DEFAULT_CONFIG };
    }
  }
  document.getElementById('cfgApiUrl').value = config.apiUrl;
  document.getElementById('cfgApiKey').value = config.apiKey;
  document.getElementById('cfgStoreId').value = config.storeId;
}

function saveConfig(newConfig) {
  config = { ...config, ...newConfig };
  localStorage.setItem('nebula_cloud_config', JSON.stringify(config));
  closeModal('settingsModal');
  refreshAllData();
}

// Service Worker Registration
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.log('SW registration error:', err);
    });
  }
}

// Event Listeners
function initEvents() {
  // Navigation
  document.querySelectorAll('.nav-tab, .mobile-nav-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const tab = btn.dataset.tab;
      if (tab) switchTab(tab);
    });
  });

  // Filter Pills
  document.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      applyFilterDates();
      loadSales();
    });
  });

  // Apply custom dates
  document.getElementById('btnApplyDates')?.addEventListener('click', () => {
    document.querySelectorAll('.pill-btn').forEach((b) => b.classList.remove('active'));
    currentFilter = 'custom';
    filterStartDate = document.getElementById('dateStart').value;
    filterEndDate = document.getElementById('dateEnd').value;
    loadSales();
  });

  // Refresh Button
  document.getElementById('btnRefresh')?.addEventListener('click', () => {
    refreshAllData();
  });

  // Settings Modal
  document.getElementById('btnSettings')?.addEventListener('click', () => {
    document.getElementById('settingsModal').classList.add('open');
  });

  document.getElementById('settingsForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveConfig({
      apiUrl: document.getElementById('cfgApiUrl').value.trim(),
      apiKey: document.getElementById('cfgApiKey').value.trim(),
      storeId: document.getElementById('cfgStoreId').value.trim()
    });
  });

  // Store selector
  document.getElementById('storeSelector')?.addEventListener('change', (e) => {
    config.storeId = e.target.value;
    refreshAllData();
  });

  // Add Stock Modal
  document.getElementById('btnOpenAddStock')?.addEventListener('click', () => {
    document.getElementById('addStockForm').reset();
    document.getElementById('addStockModal').classList.add('open');
  });

  document.getElementById('addStockForm')?.addEventListener('submit', handleAddStockSubmit);

  // Edit Product Form
  document.getElementById('editProductForm')?.addEventListener('submit', handleEditProductSubmit);

  // Product Search
  document.getElementById('productSearch')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    renderProducts(allProducts.filter(p => p.name.toLowerCase().includes(q) || (p.category_name && p.category_name.toLowerCase().includes(q))));
  });
}

// Navigation Tabs
function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll('.mobile-nav-btn').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll('.view-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${tabName}`);
  });
}

// Date Range Calculation
function initDateFilters() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('dateStart').value = today;
  document.getElementById('dateEnd').value = today;
  applyFilterDates();
}

function applyFilterDates() {
  const now = new Date();
  const formatYMD = (d) => d.toISOString().split('T')[0];

  if (currentFilter === 'today') {
    filterStartDate = formatYMD(now);
    filterEndDate = formatYMD(now);
  } else if (currentFilter === 'yesterday') {
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    filterStartDate = formatYMD(yest);
    filterEndDate = formatYMD(yest);
  } else if (currentFilter === 'week') {
    const start = new Date(now);
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1); // Monday
    filterStartDate = formatYMD(start);
    filterEndDate = formatYMD(now);
  } else if (currentFilter === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    filterStartDate = formatYMD(start);
    filterEndDate = formatYMD(now);
  } else if (currentFilter === 'all') {
    filterStartDate = null;
    filterEndDate = null;
  }
}

// Global Data Refresh
async function refreshAllData(silent = false) {
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');

  try {
    await loadStores();
    await Promise.all([
      loadSales(),
      loadInventory(),
      loadInventoryLogs(),
      loadProducts(),
      loadShifts()
    ]);

    statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
    statusBadge.style.color = '#10B981';
    statusText.innerText = 'En Línea';
  } catch (err) {
    console.error('Data refresh error:', err);
    statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
    statusBadge.style.color = '#EF4444';
    statusText.innerText = 'Error Conexión';
  }
}

// 1. Stores
async function loadStores() {
  try {
    const stores = await apiRequest('stores?select=*');
    const select = document.getElementById('storeSelector');
    if (stores && stores.length > 0) {
      select.innerHTML = stores.map(s => `<option value="${s.id}" ${s.id === config.storeId ? 'selected' : ''}>${s.name}</option>`).join('');
    }
  } catch (e) {
    // If stores table has no permission or is empty, fallback to configured
  }
}

// 2. Sales
async function loadSales() {
  let endpoint = `sales?store_id=eq.${config.storeId}&order=created_at.desc`;
  if (filterStartDate) {
    endpoint += `&created_at=gte.${filterStartDate}T00:00:00`;
  }
  if (filterEndDate) {
    endpoint += `&created_at=lte.${filterEndDate}T23:59:59`;
  }

  try {
    const sales = await apiRequest(endpoint);
    renderSales(sales || []);
  } catch (e) {
    document.getElementById('salesTableBody').innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <p style="color: var(--warning);">No se pudieron cargar las ventas: ${e.message}</p>
          </div>
        </td>
      </tr>`;
  }
}

function renderSales(sales) {
  let totalSales = 0;
  let cashSales = 0;
  let cardSales = 0;

  sales.forEach((s) => {
    const val = Number(s.total) || 0;
    totalSales += val;
    const method = (s.payment_method || '').toLowerCase();
    if (method.includes('efectivo') || method.includes('cash')) {
      cashSales += val;
    } else {
      cardSales += val;
    }
  });

  const avgTicket = sales.length > 0 ? totalSales / sales.length : 0;

  document.getElementById('kpiTotalSales').innerText = formatCurrency(totalSales);
  document.getElementById('kpiSalesSubtitle').innerText = `${sales.length} transacciones registradas`;
  document.getElementById('kpiAvgTicket').innerText = formatCurrency(avgTicket);
  document.getElementById('kpiCashSales').innerText = formatCurrency(cashSales);
  document.getElementById('kpiCardSales').innerText = formatCurrency(cardSales);
  document.getElementById('salesCountBadge').innerText = `${sales.length} Ventas`;

  const tbody = document.getElementById('salesTableBody');
  if (sales.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <div class="empty-icon">🧾</div>
            <p>No se encontraron transacciones en este período.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = sales.map((s) => {
    const method = s.payment_method || 'Efectivo';
    let badgeClass = 'badge-cash';
    if (method.toLowerCase().includes('tarjeta')) badgeClass = 'badge-card';
    if (method.toLowerCase().includes('transferencia')) badgeClass = 'badge-transfer';

    return `
      <tr>
        <td><strong>${s.turn_number || 'S/N'}</strong></td>
        <td>${formatDate(s.created_at)}</td>
        <td>${s.table_name || 'Mostrador'}</td>
        <td>${s.user_name || 'Caja'}</td>
        <td><span class="badge ${badgeClass}">${method}</span></td>
        <td style="font-weight: 700; color: #FFF;">${formatCurrency(s.total)}</td>
        <td style="text-align: right;">
          <button class="btn-secondary" style="padding: 5px 10px; font-size: 0.78rem;" onclick='viewTicketDetail(${JSON.stringify(s).replace(/'/g, "&apos;")})'>
            Ver Ticket
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.viewTicketDetail = function (sale) {
  document.getElementById('modalTicketTitle').innerText = `Ticket ${sale.turn_number || ''}`;
  document.getElementById('modalTicketMeta').innerText = `${formatDate(sale.created_at)} | Mesa: ${sale.table_name || 'Sin Mesa'} | Cajero: ${sale.user_name || 'Caja'}`;

  let items = [];
  try {
    if (typeof sale.items_json === 'string') {
      items = JSON.parse(sale.items_json);
    } else if (Array.isArray(sale.items_json)) {
      items = sale.items_json;
    }
  } catch (e) {
    items = [];
  }

  const itemsContainer = document.getElementById('modalTicketItems');
  if (items.length === 0) {
    itemsContainer.innerHTML = `<p style="color: var(--text-muted); padding: 12px 0;">No se detallaron ítems en el registro.</p>`;
  } else {
    itemsContainer.innerHTML = items.map(item => `
      <div class="ticket-item">
        <div>
          <strong style="color: #FFF;">${item.Quantity || item.quantity || 1}x ${item.ProductName || item.name || 'Producto'}</strong>
          ${item.SizeName || item.size ? `<span style="font-size: 0.75rem; color: #A78BFA; margin-left: 6px;">(${item.SizeName || item.size})</span>` : ''}
          <div style="font-size: 0.75rem; color: var(--text-muted);">${formatCurrency(item.UnitPrice || item.price || 0)} c/u</div>
        </div>
        <div style="font-weight: 700; color: #FFF;">
          ${formatCurrency(item.Subtotal || item.total || ((item.Quantity || 1) * (item.UnitPrice || item.price || 0)))}
        </div>
      </div>
    `).join('');
  }

  document.getElementById('modalSubtotal').innerText = formatCurrency(sale.subtotal || sale.total);
  document.getElementById('modalDiscount').innerText = formatCurrency(sale.discount || 0);
  document.getElementById('modalGrandTotal').innerText = formatCurrency(sale.total || 0);

  document.getElementById('ticketModal').classList.add('open');
};

// 3. Physical Inventory
async function loadInventory() {
  try {
    const items = await apiRequest(`physical_inventory?store_id=eq.${config.storeId}&order=name.asc`);
    physicalInventoryItems = items || [];
    renderInventory(physicalInventoryItems);
  } catch (e) {
    document.getElementById('inventoryTableBody').innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <p style="color: var(--warning);">No se pudo cargar el inventario físico: ${e.message}</p>
          </div>
        </td>
      </tr>`;
  }
}

function renderInventory(items) {
  const tbody = document.getElementById('inventoryTableBody');
  const select = document.getElementById('stockItemSelect');

  select.innerHTML = items.map(item => `<option value="${item.id}">${item.name} (${item.unit_name || 'unidades'})</option>`).join('');

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <p>No hay elementos de inventario físico registrados en esta sede.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const isLow = Number(item.current_stock) <= Number(item.min_stock);
    return `
      <tr>
        <td><strong style="color: #FFF;">${item.name}</strong></td>
        <td style="font-size: 1.05rem; font-weight: 800; color: ${isLow ? '#F87171' : '#34D399'};">
          ${item.current_stock}
        </td>
        <td style="color: var(--text-muted);">${item.min_stock}</td>
        <td>${item.unit_name || 'unidades'}</td>
        <td>
          <span class="badge ${isLow ? 'badge-danger' : 'badge-success'}">
            ${isLow ? '⚠️ Stock Bajo' : '✓ Stock Óptimo'}
          </span>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn-secondary" style="padding: 5px 10px; font-size: 0.78rem; margin-right: 4px;" onclick='openQuickStockModal("${item.id}")'>
            ➕ Añadir
          </button>
          <button class="btn-secondary" style="padding: 5px 10px; font-size: 0.78rem; color: #EF4444;" onclick='deletePhysicalItemCloud("${item.id}", "${item.name}")'>
            🗑 Eliminar
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.deletePhysicalItemCloud = async function(itemId, itemName) {
  if (!confirm(`¿Estás seguro de que deseas eliminar '${itemName}' de la nube?`)) return;
  try {
    await apiRequest(`physical_inventory?id=eq.${itemId}`, { method: 'DELETE' });
    await loadInventory();
    await loadInventoryLogs();
  } catch (err) {
    alert(`Error al eliminar: ${err.message}`);
  }
};

window.openQuickStockModal = function(itemId) {
  document.getElementById('addStockForm').reset();
  document.getElementById('stockItemSelect').value = itemId;
  document.getElementById('addStockModal').classList.add('open');
};

async function handleAddStockSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveStock');
  btn.disabled = true;
  btn.innerText = 'Guardando...';

  try {
    const itemId = document.getElementById('stockItemSelect').value;
    const qty = Number(document.getElementById('stockQuantity').value);
    const concept = document.getElementById('stockConcept').value.trim();

    const targetItem = physicalInventoryItems.find(i => i.id === itemId);
    if (!targetItem) throw new Error('Elemento no encontrado');

    const previousStock = Number(targetItem.current_stock) || 0;
    const newStock = previousStock + qty;

    // 1. Update physical_inventory
    await apiRequest(`physical_inventory?id=eq.${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        current_stock: newStock,
        updated_at: new Date().toISOString()
      }),
      headers: { 'Prefer': 'return=representation' }
    });

    // 2. Insert audit log
    await apiRequest('physical_inventory_logs', {
      method: 'POST',
      body: JSON.stringify({
        id: `${config.storeId}_log_${Date.now()}`,
        store_id: config.storeId,
        item_id: itemId,
        item_name: targetItem.name,
        concept: concept,
        quantity: qty,
        previous_stock: previousStock,
        new_stock: newStock,
        created_at: new Date().toISOString()
      })
    });

    closeModal('addStockModal');
    await loadInventory();
    await loadInventoryLogs();
  } catch (err) {
    alert(`Error al registrar stock: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerText = 'Guardar Ingreso';
  }
}

// 4. Inventory Movement Logs
async function loadInventoryLogs() {
  try {
    const logs = await apiRequest(`physical_inventory_logs?store_id=eq.${config.storeId}&order=created_at.desc&limit=25`);
    const tbody = document.getElementById('inventoryLogsBody');

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <p>No hay registros de movimientos recientes.</p>
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const isPositive = Number(l.quantity) > 0;
      return `
        <tr>
          <td>${formatDate(l.created_at)}</td>
          <td><strong style="color: #FFF;">${l.item_name}</strong></td>
          <td style="color: var(--text-muted);">${l.concept || 'Movimiento'}</td>
          <td style="font-weight: 700; color: ${isPositive ? '#34D399' : '#F87171'};">
            ${isPositive ? `+${l.quantity}` : l.quantity}
          </td>
          <td>${l.previous_stock}</td>
          <td><strong style="color: #FFF;">${l.new_stock}</strong></td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    // Silent on log error
  }
}

// 5. Products & Prices
async function loadProducts() {
  try {
    const products = await apiRequest(`products?store_id=eq.${config.storeId}&order=category_name.asc,name.asc`);
    allProducts = products || [];
    renderProducts(allProducts);
  } catch (e) {
    document.getElementById('productsTableBody').innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <p style="color: var(--warning);">No se pudieron cargar los productos: ${e.message}</p>
          </div>
        </td>
      </tr>`;
  }
}

function renderProducts(products) {
  const tbody = document.getElementById('productsTableBody');
  if (products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-icon">🍸</div>
            <p>No se encontraron productos en el catálogo de esta sede.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => `
    <tr>
      <td><strong style="color: #FFF;">${p.name}</strong></td>
      <td><span class="badge badge-card">${p.category_name || 'General'}</span></td>
      <td style="font-size: 1.05rem; font-weight: 800; color: #FFF;">${formatCurrency(p.price)}</td>
      <td>
        ${p.is_physical_inventory_tracked ? `<span class="badge badge-success">📦 Descuenta Físico (${p.physical_inventory_units_per_product || 1})</span>` : `<span style="color: var(--text-muted); font-size: 0.8rem;">Estándar</span>`}
      </td>
      <td>
        <span class="badge ${p.is_active ? 'badge-success' : 'badge-danger'}">
          ${p.is_active ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td style="text-align: right;">
        <button class="btn-secondary" style="padding: 5px 10px; font-size: 0.78rem;" onclick='openEditProductModal(${JSON.stringify(p).replace(/'/g, "&apos;")})'>
          ✏️ Modificar
        </button>
      </td>
    </tr>
  `).join('');
}

window.openEditProductModal = function(prod) {
  document.getElementById('editProductId').value = prod.id;
  document.getElementById('editProductName').value = prod.name;
  document.getElementById('editProductPrice').value = prod.price || 0;
  document.getElementById('editProductActive').value = prod.is_active ? 'true' : 'false';
  document.getElementById('editProductModal').classList.add('open');
};

async function handleEditProductSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveProduct');
  btn.disabled = true;
  btn.innerText = 'Actualizando...';

  try {
    const prodId = document.getElementById('editProductId').value;
    const price = Number(document.getElementById('editProductPrice').value);
    const isActive = document.getElementById('editProductActive').value === 'true';

    await apiRequest(`products?id=eq.${prodId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        price: price,
        is_active: isActive,
        updated_at: new Date().toISOString()
      }),
      headers: { 'Prefer': 'return=representation' }
    });

    closeModal('editProductModal');
    await loadProducts();
  } catch (err) {
    alert(`Error al actualizar producto: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerText = 'Actualizar Precio';
  }
}

// 6. Shift Reports
async function loadShifts() {
  try {
    const shifts = await apiRequest(`shift_reports?store_id=eq.${config.storeId}&order=created_at.desc&limit=30`);
    const tbody = document.getElementById('shiftsTableBody');

    if (!shifts || shifts.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-icon">⏰</div>
              <p>No hay reportes de cierre de turno registrados.</p>
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = shifts.map(s => {
      let discountsText = '-';
      try {
        const d = typeof s.physical_discounts_json === 'string' ? JSON.parse(s.physical_discounts_json) : s.physical_discounts_json;
        if (Array.isArray(d) && d.length > 0) {
          discountsText = d.map(item => `${item.ItemName || item.name}: ${item.TotalDiscounted || item.qty}`).join(', ');
        }
      } catch (e) { }

      return `
        <tr>
          <td><strong>#${s.shift_id || s.id}</strong></td>
          <td>${s.user_name || 'Cajero'}</td>
          <td>${formatDate(s.started_at)}</td>
          <td>${formatDate(s.ended_at)}</td>
          <td style="font-weight: 700; color: #34D399;">${formatCurrency(s.total_sales)}</td>
          <td style="color: #F87171;">${formatCurrency(s.total_expenses)}</td>
          <td style="font-size: 0.8rem; color: #A78BFA;">${discountsText}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    // Silent on shifts error
  }
}

// Close Modal Helper
window.closeModal = function(modalId) {
  document.getElementById(modalId)?.classList.remove('open');
};

// Close modal when clicking on backdrop
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
  }
});
