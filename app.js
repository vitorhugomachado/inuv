/* ==========================================================================
   FIBRADEPLOY - STATE MANAGEMENT AND ROUTING (EXPANDED WEB SPA)
   ========================================================================== */

// --- Constants ---
const STORAGE_KEY = 'fibradeploy_expanded_state_v2';

const DEFAULT_CATEGORIES = {
  cabos: 'Cabo de Fibra',
  conectores: 'Conectores / Splitters',
  ferragens: 'Ferragens de Fixação',
  equipamentos: 'Equipamentos / Ativos',
  outros: 'Outros'
};

const DEFAULT_UNITS = {
  metro: 'Metros',
  unidade: 'Unidades',
  caixa: 'Caixas',
  rolo: 'Rolos'
};

const STATUS_LABELS = {
  planejamento: 'Planejamento',
  em_andamento: 'Em Andamento',
  finalizado: 'Finalizado'
};

// --- Mock Data ---
const MOCK_STATE = {
  materials: [],
  inventoryTransactions: [], // NEW
  deployments: [],
  deliveries: [],
  consumptions: [],
  returns: [],
  teams: [],
  expenses: [],
  laborPayments: [],
  services: []
};

// ==========================================
// 0. SUPABASE CLOUD CONNECTION (LOCAL-FIRST REPLICATOR)
// ==========================================
let SUPABASE_URL = localStorage.getItem('fibradeploy_supabase_url') || 'https://tyywjswtnpzwoufnbenq.supabase.co';
let SUPABASE_ANON_KEY = localStorage.getItem('fibradeploy_supabase_anon_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5eXdqc3d0bnB6d291Zm5iZW5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNjQ4OTQsImV4cCI6MjA5NDk0MDg5NH0.SN77NBg4D2dJudoKTQgwreQj8zzO-j6mPEIU4bnyzR0';

let supabaseClient = null;
function initSupabaseClient() {
  supabaseClient = null;
  if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function' && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== '') {
    try {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('☁️ Replicador Supabase Cloud ativado com sucesso!');
      return true;
    } catch (e) {
      console.error('Falha ao inicializar o Supabase:', e);
      return false;
    }
  } else {
    console.log('🏠 Rodando no modo Local-First (Offline/LocalStorage). Para persistir dados na nuvem Supabase, configure a sua SUPABASE_ANON_KEY na tela de Configurações!');
    return false;
  }
}

initSupabaseClient();

// ==========================================
// SERVICE WORKER REGISTRATION
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('⚡ Service Worker registrado:', reg.scope))
      .catch(err => console.warn('SW não registrado:', err));
  });
}

// ==========================================
// FRONTEND CACHE (stale-while-revalidate via localStorage)
// ==========================================
const CACHE_META_KEY = 'fibradeploy_cache_meta';
const CACHE_TTL_FRONT = 5 * 60 * 1000; // 5 minutos

function getCacheMeta() {
  try { return JSON.parse(localStorage.getItem(CACHE_META_KEY) || '{}'); } catch { return {}; }
}
function setCacheMeta(meta) {
  try { localStorage.setItem(CACHE_META_KEY, JSON.stringify(meta)); } catch {}
}
function isCacheValid() {
  const meta = getCacheMeta();
  return meta.lastSync && (Date.now() - meta.lastSync < CACHE_TTL_FRONT);
}
function markCacheUpdated() {
  setCacheMeta({ lastSync: Date.now() });
}

// ==========================================
// 1. STATE STORE (LOCAL STORAGE PERSISTENCE & CLOUD SYNC)
// ==========================================

class FibraStore {
  constructor() {
    this.state = this.loadState();
    this.onSyncCallback = null;
    if (supabaseClient) {
      this.syncFromSupabase();
    }
  }

  loadState() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (!parsed.deliveries) parsed.deliveries = [];
        if (!parsed.consumptions) parsed.consumptions = [];
        if (!parsed.returns) parsed.returns = [];
        if (!parsed.teams) parsed.teams = [];
        if (!parsed.materials) parsed.materials = [];
        if (!parsed.expenses) parsed.expenses = [];
        if (!parsed.laborPayments) parsed.laborPayments = [];
        if (!parsed.services) parsed.services = [];
        if (parsed.deployments) {
          parsed.deployments.forEach(d => {
            if (d.city === undefined || d.city === null) {
              d.city = d.id === 'd2' ? 'Petrolina' : (d.id === 'd1' ? 'Oakland' : 'Petrolina');
            }
            if (d.address === undefined || d.address === null) {
              d.address = d.id === 'd2' ? 'Av. Souza Filho, 100, Petrolina' : (d.id === 'd1' ? '2450 E 12th St, Oakland' : 'Petrolina');
            }
          });
        }
        return parsed;
      }
    } catch (e) {
      console.error('Erro ao ler localStorage', e);
    }
    this.saveState(MOCK_STATE);
    return JSON.parse(JSON.stringify(MOCK_STATE));
  }

  saveState(stateToSave = this.state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.error('Erro ao salvar no localStorage', e);
    }
  }

  // --- Supabase Replicator (Sync Engine) ---
  async syncFromSupabase(force = false) {
    if (!supabaseClient) return;
    
    // Se o cache ainda é válido e não é forçado, usa localStorage (instantâneo)
    if (!force && isCacheValid()) {
      console.log('⚡ Cache válido — usando dados locais (sem request ao Supabase)');
      // Defer para garantir que AppView já registrou o onSyncCallback
      setTimeout(() => { if (this.onSyncCallback) this.onSyncCallback(); }, 0);
      return;
    }

    try {
      console.log('🔄 Sincronizando dados com a nuvem Supabase...');
      
      const { data: materials, error: errMat } = await supabaseClient.from('materials').select('*');
      if (errMat) throw errMat;

      const { data: deployments, error: errDep } = await supabaseClient.from('deployments').select('*');
      if (errDep) throw errDep;

      const { data: planned, error: errPlan } = await supabaseClient.from('planned_materials').select('*');
      if (errPlan) throw errPlan;

      const { data: deliveries, error: errDel } = await supabaseClient.from('deliveries').select('*');
      if (errDel) throw errDel;

      const { data: consumptions, error: errCons } = await supabaseClient.from('consumptions').select('*');
      if (errCons) throw errCons;

      const { data: returns, error: errRet } = await supabaseClient.from('returns').select('*');
      if (errRet) throw errRet;

      // Safe retrieval of teams from Supabase (may not exist)
      let sbTeams = [];
      try {
        const { data: teamsData, error: errTeams } = await supabaseClient.from('teams').select('*');
        if (!errTeams && teamsData) {
          sbTeams = teamsData.map(t => ({
            id: t.id,
            name: t.name,
            responsible: t.responsible
          }));
        }
      } catch (e) {
        console.warn('Tabela "teams" não configurada no Supabase Cloud. Usando base local para equipes.');
      }

      // Safe retrieval of expenses from Supabase (may not exist)
      let sbExpenses = [];
      try {
        const { data: expensesData, error: errExpenses } = await supabaseClient.from('expenses').select('*');
        if (!errExpenses && expensesData) {
          sbExpenses = expensesData.map(e => ({
            id: e.id,
            deploymentId: e.deployment_id || e.deploymentId,
            type: e.type,
            value: parseFloat(e.value),
            description: e.description,
            date: e.date || new Date().toISOString().split('T')[0]
          }));
        }
      } catch (e) {
        console.warn('Tabela "expenses" não configurada no Supabase Cloud. Usando base local para despesas.');
      }

      // Safe retrieval of labor payments from Supabase (may not exist)
      let sbLaborPayments = [];
      try {
        const { data: laborData, error: errLabor } = await supabaseClient.from('labor_payments').select('*');
        if (!errLabor && laborData) {
          sbLaborPayments = laborData.map(l => ({
            id: l.id,
            deploymentId: l.deployment_id || l.deploymentId,
            team: l.team,
            description: l.description,
            value: parseFloat(l.value),
            date: l.date || new Date().toISOString().split('T')[0]
          }));
        }
      } catch (e) {
        console.warn('Tabela "labor_payments" não configurada no Supabase Cloud. Usando base local para pagamentos de mão de obra.');
      }

      // Map back to memory structure
      const freshState = {
        materials: materials.map(m => ({
          id: m.id,
          name: m.name,
          category: m.category,
          unit: m.unit,
          quantity: parseFloat(m.quantity),
          unitValue: parseFloat(m.unit_value),
          minStock: parseFloat(m.min_stock)
        })),
        deployments: deployments.map(d => {
          const pmats = planned
            .filter(p => p.deployment_id === d.id)
            .map(p => ({
              id: p.id,
              materialId: p.material_id,
              quantity: parseFloat(p.quantity),
              unitValue: parseFloat(p.unit_value)
            }));
          return {
            id: d.id,
            name: d.name,
            status: d.status,
            startDate: d.start_date,
            endDate: d.end_date,
            responsible: d.responsible,
            notes: d.notes || '',
            city: d.city || '',
            address: d.address || '',
            plannedMaterials: pmats
          };
        }),
        deliveries: deliveries.map(del => ({
          id: del.id,
          deploymentId: del.deployment_id,
          team: del.team,
          materialId: del.material_id,
          quantity: parseFloat(del.quantity),
          date: del.date,
          notes: del.notes || ''
        })),
        consumptions: consumptions.map(c => ({
          id: c.id,
          deploymentId: c.deployment_id,
          team: c.team,
          materialId: c.material_id,
          quantity: parseFloat(c.quantity),
          date: c.date,
          responsible: c.responsible
        })),
        returns: returns.map(r => ({
          id: r.id,
          deploymentId: r.deployment_id,
          team: r.team,
          materialId: r.material_id,
          quantity: parseFloat(r.quantity),
          date: r.date,
          notes: r.notes || ''
        })),
        teams: sbTeams.length > 0 ? sbTeams : (this.state.teams || [
          { id: 'team_alfa', name: 'Equipe Alfa', responsible: 'Carlos Eduardo' },
          { id: 'team_beta', name: 'Equipe Beta', responsible: 'Anderson Silva' }
        ]),
        expenses: sbExpenses.length > 0 ? sbExpenses : (this.state.expenses || []),
        laborPayments: sbLaborPayments.length > 0 ? sbLaborPayments : (this.state.laborPayments || [])
      };

      this.state = freshState;
      this.saveState();
      markCacheUpdated();
      console.log('✅ Sincronização concluída! Telas atualizadas.');
      if (this.onSyncCallback) {
        this.onSyncCallback();
      }
    } catch (e) {
      console.error('❌ Falha ao sincronizar com o Supabase:', e.message || e);
    }
  }

  // --- Background Cloud Push Triggers ---
  async pushMaterial(m) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('materials').upsert({
        id: m.id,
        name: m.name,
        category: m.category,
        unit: m.unit,
        quantity: m.quantity,
        unit_value: m.unitValue,
        min_stock: m.minStock
      });
    } catch (e) {
      console.error('Erro de sincronização de Material:', e);
    }
  }

  async deleteMaterialFromCloud(id) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('materials').delete().eq('id', id);
    } catch (e) {
      console.error('Erro de exclusão de Material:', e);
    }
  }

  async pushDeployment(d) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('deployments').upsert({
        id: d.id,
        name: d.name,
        status: d.status,
        start_date: d.startDate,
        end_date: d.endDate,
        responsible: d.responsible,
        notes: d.notes || '',
        city: d.city || '',
        address: d.address || ''
      });
    } catch (e) {
      console.error('Erro de sincronização de Lançamento:', e);
    }
  }

  async deleteDeploymentFromCloud(id) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('deployments').delete().eq('id', id);
    } catch (e) {
      console.error('Erro de exclusão de Lançamento:', e);
    }
  }

  async pushPlannedMaterial(deploymentId, pm) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('planned_materials').upsert({
        id: pm.id,
        deployment_id: deploymentId,
        material_id: pm.materialId,
        quantity: pm.quantity,
        unit_value: pm.unitValue
      });
    } catch (e) {
      console.error('Erro de sincronização de Item Planejado:', e);
    }
  }

  async deletePlannedMaterialFromCloud(id) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('planned_materials').delete().eq('id', id);
    } catch (e) {
      console.error('Erro de exclusão de Item Planejado:', e);
    }
  }

  async pushDelivery(del) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('deliveries').upsert({
        id: del.id,
        deployment_id: del.deploymentId,
        team: del.team,
        material_id: del.materialId,
        quantity: del.quantity,
        date: del.date,
        notes: del.notes || ''
      });
      const mat = this.getMaterial(del.materialId);
      if (mat) await this.pushMaterial(mat);
    } catch (e) {
      console.error('Erro de sincronização de Entrega:', e);
    }
  }

  async deleteDeliveryFromCloud(id, materialId) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('deliveries').delete().eq('id', id);
      const mat = this.getMaterial(materialId);
      if (mat) await this.pushMaterial(mat);
    } catch (e) {
      console.error('Erro de exclusão de Entrega:', e);
    }
  }

  async pushConsumption(cons) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('consumptions').upsert({
        id: cons.id,
        deployment_id: cons.deploymentId,
        team: cons.team,
        material_id: cons.materialId,
        quantity: cons.quantity,
        date: cons.date,
        responsible: cons.responsible
      });
    } catch (e) {
      console.error('Erro de sincronização de Consumo:', e);
    }
  }

  async deleteConsumptionFromCloud(id) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('consumptions').delete().eq('id', id);
    } catch (e) {
      console.error('Erro de exclusão de Consumo:', e);
    }
  }

  async pushReturn(ret) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('returns').upsert({
        id: ret.id,
        deployment_id: ret.deploymentId,
        team: ret.team,
        material_id: ret.materialId,
        quantity: ret.quantity,
        date: ret.date,
        notes: ret.notes || ''
      });
      const mat = this.getMaterial(ret.materialId);
      if (mat) await this.pushMaterial(mat);
    } catch (e) {
      console.error('Erro de sincronização de Devolução:', e);
    }
  }

  async deleteReturnFromCloud(id, materialId) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('returns').delete().eq('id', id);
      const mat = this.getMaterial(materialId);
      if (mat) await this.pushMaterial(mat);
    } catch (e) {
      console.error('Erro de exclusão de Devolução:', e);
    }
  }

  // --- Materials CRUD ---
  getMaterials() {
    return this.state.materials;
  }

  getMaterial(id) {
    return this.state.materials.find(m => m.id === id);
  }

  addMaterial(materialData) {
    const newMaterial = {
      id: 'mat_' + Math.random().toString(36).substr(2, 9),
      ...materialData
    };
    this.state.materials.push(newMaterial);
    this.saveState();
    this.pushMaterial(newMaterial);
    return newMaterial;
  }

  updateMaterial(id, updatedData) {
    const index = this.state.materials.findIndex(m => m.id === id);
    if (index !== -1) {
      this.state.materials[index] = {
        ...this.state.materials[index],
        ...updatedData
      };
      this.saveState();
      this.pushMaterial(this.state.materials[index]);
      return this.state.materials[index];
    }
    return null;
  }

  deleteMaterial(id) {
    const inUse = this.state.deployments.some(d => 
      d.plannedMaterials.some(p => p.materialId === id) && d.status !== 'finalizado'
    );
    if (inUse) {
      throw new Error('Não é possível excluir este material pois ele está associado ao planejamento de uma obra ativa ou pendente.');
    }
    
    this.state.materials = this.state.materials.filter(m => m.id !== id);
    this.saveState();
    this.deleteMaterialFromCloud(id);
  }

  // --- Inventory Transactions CRUD ---
  getInventoryTransactions() {
    return this.state.inventoryTransactions || [];
  }

  getInventoryTransactionsByItem(itemId) {
    return this.getInventoryTransactions().filter(t => t.itemId === itemId);
  }

  addInventoryTransaction(transactionData) {
    if (!this.state.inventoryTransactions) this.state.inventoryTransactions = [];
    const newTransaction = {
      id: 'txn_' + Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString().split('T')[0], // fallback
      ...transactionData
    };
    this.state.inventoryTransactions.push(newTransaction);
    this.saveState();
    
    // Auto-update quantity if it's a material
    if (transactionData.itemId) {
      const item = this.getMaterial(transactionData.itemId);
      if (item && item.type === 'material') {
        const qty = parseFloat(transactionData.quantity) || 0;
        if (transactionData.type === 'entrada' || transactionData.type === 'devolucao' || transactionData.type === 'ajuste_positivo') {
          item.quantity += qty;
        } else if (transactionData.type === 'saida' || transactionData.type === 'consumo_obra' || transactionData.type === 'ajuste_negativo') {
          item.quantity -= qty;
        }
        this.updateMaterial(item.id, { quantity: item.quantity });
      }
    }
    
    return newTransaction;
  }

  // --- Users CRUD ---
  getUsers() {
    try {
      const data = localStorage.getItem('inuv_fibras_users');
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('Erro ao ler usuários', e);
    }
    const defaultUsers = [
      { name: 'Administrador', username: 'admin', password: 'admin123' }
    ];
    localStorage.setItem('inuv_fibras_users', JSON.stringify(defaultUsers));
    return defaultUsers;
  }

  saveUsers(users) {
    try {
      localStorage.setItem('inuv_fibras_users', JSON.stringify(users));
    } catch (e) {
      console.error('Erro ao salvar usuários', e);
    }
  }

  addUser(user) {
    const users = this.getUsers();
    if (users.some(u => u.username.toLowerCase() === user.username.toLowerCase())) {
      throw new Error('Este nome de usuário já está cadastrado.');
    }
    users.push(user);
    this.saveUsers(users);
  }

  deleteUser(username) {
    const users = this.getUsers();
    if (username === 'admin') {
      throw new Error('Não é possível excluir o usuário administrador padrão.');
    }
    const filtered = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
    this.saveUsers(filtered);
  }

  // --- Teams CRUD ---
  getTeams() {
    if (!this.state.teams) this.state.teams = [];
    return this.state.teams;
  }

  getTeam(id) {
    return this.getTeams().find(t => t.id === id);
  }

  addTeam(teamData) {
    const newTeam = {
      id: 'team_' + Math.random().toString(36).substr(2, 9),
      name: teamData.name.trim(),
      responsible: teamData.responsible.trim()
    };
    this.getTeams().push(newTeam);
    this.saveState();
    this.pushTeam(newTeam);
    return newTeam;
  }

  updateTeam(id, updatedData) {
    const teamsList = this.getTeams();
    const index = teamsList.findIndex(t => t.id === id);
    if (index !== -1) {
      teamsList[index] = {
        ...teamsList[index],
        name: updatedData.name.trim(),
        responsible: updatedData.responsible.trim()
      };
      this.saveState();
      this.pushTeam(teamsList[index]);
      return teamsList[index];
    }
    return null;
  }

  deleteTeam(id) {
    this.state.teams = this.getTeams().filter(t => t.id !== id);
    this.saveState();
    this.deleteTeamFromCloud(id);
  }

  async pushTeam(t) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('teams').upsert({
        id: t.id,
        name: t.name,
        responsible: t.responsible
      });
    } catch (e) {
      console.warn('Erro de sincronização de Equipe no Supabase:', e);
    }
  }

  async deleteTeamFromCloud(id) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('teams').delete().eq('id', id);
    } catch (e) {
      console.warn('Erro de exclusão de Equipe no Supabase:', e);
    }
  }

  // --- Expenses CRUD ---
  getExpenses() {
    if (!this.state.expenses) this.state.expenses = [];
    return this.state.expenses;
  }

  addExpense(expenseData) {
    const newExpense = {
      id: 'expense_' + Math.random().toString(36).substr(2, 9),
      deploymentId: expenseData.deploymentId,
      type: expenseData.type,
      value: parseFloat(expenseData.value),
      description: expenseData.description.trim(),
      date: expenseData.date || new Date().toISOString().split('T')[0]
    };
    this.getExpenses().push(newExpense);
    this.saveState();
    this.pushExpense(newExpense);
    return newExpense;
  }

  deleteExpense(id) {
    this.state.expenses = this.getExpenses().filter(e => e.id !== id);
    this.saveState();
    this.deleteExpenseFromCloud(id);
  }

  async pushExpense(e) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('expenses').upsert({
        id: e.id,
        deployment_id: e.deploymentId,
        type: e.type,
        value: e.value,
        description: e.description,
        date: e.date
      });
    } catch (err) {
      console.warn('Erro de sincronização de Despesa no Supabase:', err);
    }
  }

  async deleteExpenseFromCloud(id) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('expenses').delete().eq('id', id);
    } catch (err) {
      console.warn('Erro de exclusão de Despesa no Supabase:', err);
    }
  }

  // --- Labor Payments CRUD ---
  getLaborPayments() {
    if (!this.state.laborPayments) this.state.laborPayments = [];
    return this.state.laborPayments;
  }

  addLaborPayment(paymentData) {
    const newPayment = {
      id: 'labor_' + Math.random().toString(36).substr(2, 9),
      deploymentId: paymentData.deploymentId,
      team: paymentData.team.trim(),
      description: paymentData.description.trim(),
      value: parseFloat(paymentData.value),
      date: paymentData.date || new Date().toISOString().split('T')[0]
    };
    this.getLaborPayments().push(newPayment);
    this.saveState();
    this.pushLaborPayment(newPayment);
    return newPayment;
  }

  deleteLaborPayment(id) {
    this.state.laborPayments = this.getLaborPayments().filter(lp => lp.id !== id);
    this.saveState();
    this.deleteLaborPaymentFromCloud(id);
  }

  async pushLaborPayment(p) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('labor_payments').upsert({
        id: p.id,
        deployment_id: p.deploymentId,
        team: p.team,
        description: p.description,
        value: p.value,
        date: p.date
      });
    } catch (err) {
      console.warn('Erro de sincronização de Pagamento de Mão de Obra no Supabase:', err);
    }
  }

  async deleteLaborPaymentFromCloud(id) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('labor_payments').delete().eq('id', id);
    } catch (err) {
      console.warn('Erro de exclusão de Pagamento de Mão de Obra no Supabase:', err);
    }
  }

  // --- Services CRUD ---
  getServices() {
    if (!this.state.services) this.state.services = [];
    return this.state.services;
  }

  addService(serviceData) {
    const newService = {
      id: 'srv_' + Math.random().toString(36).substr(2, 9),
      name: serviceData.name.trim(),
      unit: serviceData.unit,
      unitValue: parseFloat(serviceData.unitValue),
      description: (serviceData.description || '').trim()
    };
    this.getServices().push(newService);
    this.saveState();
    return newService;
  }

  updateService(id, updatedData) {
    const srv = this.getServices().find(s => s.id === id);
    if (!srv) throw new Error('Serviço não encontrado.');
    
    srv.name = updatedData.name.trim();
    srv.unit = updatedData.unit;
    srv.unitValue = parseFloat(updatedData.unitValue);
    srv.description = (updatedData.description || '').trim();
    
    this.saveState();
    return srv;
  }

  deleteService(id) {
    this.state.services = this.getServices().filter(s => s.id !== id);
    this.saveState();
  }

  // --- Deployments CRUD ---
  getDeployments() {
    return this.state.deployments;
  }

  getDeployment(id) {
    return this.state.deployments.find(d => d.id === id);
  }

  addDeployment(deploymentData) {
    const newDeployment = {
      id: 'dep_' + Math.random().toString(36).substr(2, 9),
      name: deploymentData.name,
      status: deploymentData.status,
      startDate: deploymentData.startDate,
      endDate: deploymentData.endDate,
      responsible: deploymentData.responsible,
      notes: deploymentData.notes || '',
      city: deploymentData.city || '',
      address: deploymentData.address || '',
      plannedMaterials: [],
      laborItems: []
    };
    this.state.deployments.push(newDeployment);
    this.saveState();
    this.pushDeployment(newDeployment);
    return newDeployment;
  }

  updateDeployment(id, updatedData) {
    const index = this.state.deployments.findIndex(d => d.id === id);
    if (index !== -1) {
      this.state.deployments[index] = {
        ...this.state.deployments[index],
        ...updatedData
      };
      this.saveState();
      this.pushDeployment(this.state.deployments[index]);
      return this.state.deployments[index];
    }
    return null;
  }

  deleteDeployment(id) {
    this.state.deployments = this.state.deployments.filter(d => d.id !== id);
    this.saveState();
    this.deleteDeploymentFromCloud(id);
  }

  // --- Phase 3 Logistics Ledger CRUD ---
  getDeliveries() {
    return this.state.deliveries || [];
  }

  getDelivery(id) {
    return this.state.deliveries.find(d => d.id === id);
  }

  addDelivery(deliveryData) {
    const material = this.getMaterial(deliveryData.materialId);
    if (!material) throw new Error('Material não encontrado no estoque.');

    const qtyVal = parseFloat(deliveryData.quantity);
    if (isNaN(qtyVal) || qtyVal <= 0) throw new Error('A quantidade de entrega deve ser maior que zero.');

    if (material.quantity < qtyVal) {
      throw new Error(`Estoque insuficiente! Apenas ${material.quantity} ${DEFAULT_UNITS[material.unit].toLowerCase()} disponíveis no estoque físico.`);
    }

    material.quantity = parseFloat((material.quantity - qtyVal).toFixed(4));

    const newDelivery = {
      id: 'del_' + Math.random().toString(36).substr(2, 9),
      deploymentId: deliveryData.deploymentId,
      team: deliveryData.team.trim(),
      materialId: deliveryData.materialId,
      quantity: qtyVal,
      date: deliveryData.date,
      notes: deliveryData.notes || ''
    };

    this.state.deliveries.push(newDelivery);
    this.saveState();
    this.pushDelivery(newDelivery);
    return newDelivery;
  }

  updateDelivery(id, updatedData) {
    const index = this.state.deliveries.findIndex(d => d.id === id);
    if (index === -1) throw new Error('Entrega não encontrada.');

    const oldDelivery = this.state.deliveries[index];
    const material = this.getMaterial(oldDelivery.materialId);
    if (!material) throw new Error('Material original não encontrado no estoque.');

    const newQty = parseFloat(updatedData.quantity);
    if (isNaN(newQty) || newQty <= 0) throw new Error('A quantidade deve ser maior que zero.');

    const diff = newQty - oldDelivery.quantity;

    if (diff > 0 && material.quantity < diff) {
      throw new Error(`Estoque insuficiente para reajustar esta entrega! Faltam ${(diff - material.quantity).toFixed(2)} ${DEFAULT_UNITS[material.unit].toLowerCase()} no estoque físico.`);
    }

    const possession = this.getTeamPossession(oldDelivery.deploymentId, oldDelivery.team, oldDelivery.materialId);
    if (possession.balance + diff < 0) {
      throw new Error(`Não é possível reajustar a entrega para ${newQty}! A equipe "${oldDelivery.team}" já consumiu/devolveu este material e o saldo com eles ficaria negativo em ${(Math.abs(possession.balance + diff)).toFixed(2)}.`);
    }

    material.quantity = parseFloat((material.quantity - diff).toFixed(4));

    this.state.deliveries[index] = {
      ...oldDelivery,
      team: updatedData.team.trim(),
      quantity: newQty,
      date: updatedData.date,
      notes: updatedData.notes || ''
    };

    this.saveState();
    this.pushDelivery(this.state.deliveries[index]);
    return this.state.deliveries[index];
  }

  deleteDelivery(id) {
    const index = this.state.deliveries.findIndex(d => d.id === id);
    if (index === -1) throw new Error('Entrega não encontrada.');

    const delivery = this.state.deliveries[index];
    const material = this.getMaterial(delivery.materialId);
    if (!material) throw new Error('Material associado não encontrado no estoque.');

    const possession = this.getTeamPossession(delivery.deploymentId, delivery.team, delivery.materialId);
    if (possession.balance - delivery.quantity < 0) {
      throw new Error(`Não é possível excluir esta entrega! A equipe "${delivery.team}" já consumiu/devolveu este material e a exclusão geraria saldo negativo de ${(delivery.quantity - possession.balance).toFixed(2)} na posse deles.`);
    }

    material.quantity = parseFloat((material.quantity + delivery.quantity).toFixed(4));

    this.state.deliveries.splice(index, 1);
    this.saveState();
    this.deleteDeliveryFromCloud(id, delivery.materialId);
  }

  getConsumptions() {
    return this.state.consumptions || [];
  }

  addConsumption(consumptionData) {
    const qtyVal = parseFloat(consumptionData.quantity);
    if (isNaN(qtyVal) || qtyVal <= 0) throw new Error('A quantidade de consumo deve ser maior que zero.');

    const possession = this.getTeamPossession(consumptionData.deploymentId, consumptionData.team, consumptionData.materialId);
    if (possession.balance < qtyVal) {
      throw new Error(`Operação Negada! A equipe "${consumptionData.team}" possui apenas ${possession.balance} em posse. Não é possível consumir ${qtyVal}.`);
    }

    const newConsumption = {
      id: 'con_' + Math.random().toString(36).substr(2, 9),
      deploymentId: consumptionData.deploymentId,
      team: consumptionData.team.trim(),
      materialId: consumptionData.materialId,
      quantity: qtyVal,
      date: consumptionData.date,
      responsible: consumptionData.responsible.trim()
    };

    this.state.consumptions.push(newConsumption);
    this.saveState();
    this.pushConsumption(newConsumption);
    return newConsumption;
  }

  deleteConsumption(id) {
    const index = this.state.consumptions.findIndex(c => c.id === id);
    if (index === -1) throw new Error('Consumo não encontrado.');

    this.state.consumptions.splice(index, 1);
    this.saveState();
    this.deleteConsumptionFromCloud(id);
  }

  getReturns() {
    return this.state.returns || [];
  }

  addReturn(returnData) {
    const qtyVal = parseFloat(returnData.quantity);
    if (isNaN(qtyVal) || qtyVal <= 0) throw new Error('A quantidade de devolução deve ser maior que zero.');

    const material = this.getMaterial(returnData.materialId);
    if (!material) throw new Error('Material não encontrado no estoque.');

    const possession = this.getTeamPossession(returnData.deploymentId, returnData.team, returnData.materialId);
    if (possession.balance < qtyVal) {
      throw new Error(`Operação Negada! A equipe "${returnData.team}" possui apenas ${possession.balance} em posse. Não é possível devolver ${qtyVal}.`);
    }

    material.quantity = parseFloat((material.quantity + qtyVal).toFixed(4));

    const newReturn = {
      id: 'ret_' + Math.random().toString(36).substr(2, 9),
      deploymentId: returnData.deploymentId,
      team: returnData.team.trim(),
      materialId: returnData.materialId,
      quantity: qtyVal,
      date: returnData.date,
      notes: returnData.notes || ''
    };

    this.state.returns.push(newReturn);
    this.saveState();
    this.pushReturn(newReturn);
    return newReturn;
  }

  deleteReturn(id) {
    const index = this.state.returns.findIndex(r => r.id === id);
    if (index === -1) throw new Error('Devolução não encontrada.');

    const ret = this.state.returns[index];
    const material = this.getMaterial(ret.materialId);
    if (!material) throw new Error('Material associado não encontrado no estoque.');

    if (material.quantity < ret.quantity) {
      throw new Error(`Estoque físico indisponível para desfazer esta devolução! Atualmente existem apenas ${material.quantity} ${DEFAULT_UNITS[material.unit].toLowerCase()} no almoxarifado.`);
    }

    material.quantity = parseFloat((material.quantity - ret.quantity).toFixed(4));

    this.state.returns.splice(index, 1);
    this.saveState();
    this.deleteReturnFromCloud(id, ret.materialId);
  }

  getTeamPossession(deploymentId, team, materialId) {
    const deliveries = (this.state.deliveries || []).filter(d => d.deploymentId === deploymentId && d.team === team && d.materialId === materialId);
    const consumptions = (this.state.consumptions || []).filter(c => c.deploymentId === deploymentId && c.team === team && c.materialId === materialId);
    const returns = (this.state.returns || []).filter(r => r.deploymentId === deploymentId && r.team === team && r.materialId === materialId);

    const totalDelivered = deliveries.reduce((sum, d) => sum + d.quantity, 0);
    const totalConsumed = consumptions.reduce((sum, c) => sum + c.quantity, 0);
    const totalReturned = returns.reduce((sum, r) => sum + r.quantity, 0);

    return {
      delivered: totalDelivered,
      consumed: totalConsumed,
      returned: totalReturned,
      balance: totalDelivered - totalConsumed - totalReturned
    };
  }

  getTeamsForDeployment(deploymentId) {
    const teams = new Set();
    (this.state.deliveries || []).forEach(d => {
      if (d.deploymentId === deploymentId) {
        teams.add(d.team);
      }
    });
    return Array.from(teams);
  }

  getMaterialsForTeam(deploymentId, team) {
    const materialsInPossession = [];
    const materialIds = new Set();
    (this.state.deliveries || []).forEach(d => {
      if (d.deploymentId === deploymentId && d.team === team) {
        materialIds.add(d.materialId);
      }
    });

    materialIds.forEach(mId => {
      const material = this.getMaterial(mId);
      if (material) {
        const possession = this.getTeamPossession(deploymentId, team, mId);
        materialsInPossession.push({
          id: mId,
          name: material.name,
          unit: material.unit,
          balance: possession.balance
        });
      }
    });

    return materialsInPossession;
  }

  // --- Nested Planned Materials CRUD ---
  getPlannedMaterials(deploymentId) {
    const dep = this.getDeployment(deploymentId);
    return dep ? dep.plannedMaterials : [];
  }

  addPlannedMaterial(deploymentId, materialData) {
    const dep = this.getDeployment(deploymentId);
    if (!dep) throw new Error('Lançamento não encontrado.');

    const material = this.getMaterial(materialData.materialId);
    if (!material) throw new Error('Material selecionado não existe no estoque.');

    const existing = dep.plannedMaterials.find(p => p.materialId === materialData.materialId);
    if (existing) {
      existing.quantity += parseFloat(materialData.quantity);
      this.saveState();
      this.pushPlannedMaterial(deploymentId, existing);
    } else {
      const newPlan = {
        id: 'plan_' + Math.random().toString(36).substr(2, 9),
        materialId: materialData.materialId,
        quantity: parseFloat(materialData.quantity),
        unitValue: material.unitValue
      };
      dep.plannedMaterials.push(newPlan);
      this.saveState();
      this.pushPlannedMaterial(deploymentId, newPlan);
    }

    return dep;
  }

  updatePlannedMaterial(deploymentId, plannedItemId, quantity) {
    const dep = this.getDeployment(deploymentId);
    if (!dep) throw new Error('Lançamento não encontrado.');

    const plannedItem = dep.plannedMaterials.find(p => p.id === plannedItemId);
    if (!plannedItem) throw new Error('Item planejado não encontrado.');

    plannedItem.quantity = parseFloat(quantity);
    this.saveState();
    this.pushPlannedMaterial(deploymentId, plannedItem);
    return dep;
  }

  deletePlannedMaterial(deploymentId, plannedItemId) {
    const dep = this.getDeployment(deploymentId);
    if (!dep) throw new Error('Lançamento não encontrado.');

    dep.plannedMaterials = dep.plannedMaterials.filter(p => p.id !== plannedItemId);
    this.saveState();
    this.deletePlannedMaterialFromCloud(plannedItemId);
    return dep;
  }

  // --- Labor Items CRUD ---
  addLaborItem(deploymentId, laborData) {
    const dep = this.getDeployment(deploymentId);
    if (!dep) throw new Error('Lançamento não encontrado.');
    if (!dep.laborItems) dep.laborItems = [];

    const newItem = {
      id: 'lab_' + Math.random().toString(36).substr(2, 9),
      description: laborData.description,
      unit: laborData.unit,
      quantity: parseFloat(laborData.quantity),
      unitValue: parseFloat(laborData.unitValue)
    };
    dep.laborItems.push(newItem);
    this.saveState();
    return newItem;
  }

  updateLaborItem(deploymentId, laborItemId, data) {
    const dep = this.getDeployment(deploymentId);
    if (!dep) throw new Error('Lançamento não encontrado.');
    if (!dep.laborItems) dep.laborItems = [];

    const item = dep.laborItems.find(l => l.id === laborItemId);
    if (!item) throw new Error('Item de mão de obra não encontrado.');

    Object.assign(item, {
      description: data.description,
      unit: data.unit,
      quantity: parseFloat(data.quantity),
      unitValue: parseFloat(data.unitValue)
    });
    this.saveState();
    return item;
  }

  deleteLaborItem(deploymentId, laborItemId) {
    const dep = this.getDeployment(deploymentId);
    if (!dep) throw new Error('Lançamento não encontrado.');
    if (!dep.laborItems) dep.laborItems = [];
    dep.laborItems = dep.laborItems.filter(l => l.id !== laborItemId);
    this.saveState();
  }

  // --- Calculations for Specific Deployment ---
  getLaborTotalCost(deployment) {
    if (!deployment.laborItems) return 0;
    return deployment.laborItems.reduce((sum, item) => sum + (item.quantity * item.unitValue), 0);
  }

  getDeploymentTotalCost(deployment) {
    const materialsCost = deployment.plannedMaterials.reduce((sum, item) => sum + (item.quantity * item.unitValue), 0);
    const laborCost = this.getLaborTotalCost(deployment);
    return materialsCost + laborCost;
  }

  getDeploymentActualCost(deployment) {
    const deliveries = (this.state.deliveries || []).filter(d => d.deploymentId === deployment.id);
    const returns = (this.state.returns || []).filter(r => r.deploymentId === deployment.id);
    const expenses = (this.state.expenses || []).filter(e => e.deploymentId === deployment.id);
    const labor = (this.state.laborPayments || []).filter(l => l.deploymentId === deployment.id);
    
    let deliveredCost = 0;
    if (deliveries.length > 0) {
      deliveredCost = deliveries.reduce((sum, d) => {
        const mat = this.getMaterial(d.materialId);
        const price = mat ? mat.unitValue : d.unitValue || 0;
        return sum + (d.quantity * price);
      }, 0);
    }
      
    let returnedCost = 0;
    if (returns.length > 0) {
      returnedCost = returns.reduce((sum, r) => {
        const mat = this.getMaterial(r.materialId);
        const price = mat ? mat.unitValue : r.unitValue || 0;
        return sum + (r.quantity * price);
      }, 0);
    }
    
    const materialsCost = Math.max(0, deliveredCost - returnedCost);
    const expensesCost = expenses.reduce((sum, e) => sum + e.value, 0);
    const laborCost = labor.reduce((sum, l) => sum + l.value, 0);
    
    const actualCost = materialsCost + expensesCost + laborCost;
    
    // Se não há movimentação, retorna o planejado para não ficar zerado nos gráficos
    if (deliveries.length === 0 && returns.length === 0 && expenses.length === 0 && labor.length === 0) {
      return this.getDeploymentTotalCost(deployment);
    }
    
    return actualCost;
  }

  // --- Dashboard Aggregations ---
  getMetrics(selectedId) {
    const totalStockValue = this.state.materials.reduce((sum, m) => sum + (m.quantity * m.unitValue), 0);
    const totalMaterialsStock = this.state.materials.reduce((sum, m) => sum + m.quantity, 0);

    // Filter logistics by selected deployment ID if provided, otherwise aggregate all
    let deliveries = this.state.deliveries || [];
    let consumptions = this.state.consumptions || [];
    let returns = this.state.returns || [];

    if (selectedId) {
      deliveries = deliveries.filter(d => d.deploymentId === selectedId);
      consumptions = consumptions.filter(c => c.deploymentId === selectedId);
      returns = returns.filter(r => r.deploymentId === selectedId);
    }

    const totalDeliveriesQty = deliveries.reduce((sum, d) => sum + d.quantity, 0);
    const totalConsumptionsQty = consumptions.reduce((sum, c) => sum + c.quantity, 0);
    const totalReturnsQty = returns.reduce((sum, r) => sum + r.quantity, 0);
    const totalMaterialsField = totalDeliveriesQty - totalConsumptionsQty - totalReturnsQty;

    // Calculate cost
    let totalCost = 0;
    if (selectedId) {
      const dep = this.getDeployment(selectedId);
      if (dep) {
        totalCost = this.getDeploymentActualCost(dep);
      }
    } else {
      const activeDeployments = this.state.deployments.filter(d => d.status === 'em_andamento');
      totalCost = activeDeployments.reduce((sum, d) => {
        return sum + this.getDeploymentActualCost(d);
      }, 0);
    }

    // Active deployments count (global)
    const activeDeploymentsCount = this.state.deployments.filter(d => d.status === 'em_andamento').length;

    return {
      totalMaterialsStock,
      totalStockValue,
      totalMaterialsField,
      activeDeploymentsCount,
      totalCost
    };
  }

  getLowStockAndConflicts() {
    const alerts = [];

    this.state.materials.forEach(m => {
      if (m.quantity <= m.minStock) {
        alerts.push({
          type: 'stock',
          id: m.id,
          name: m.name,
          qty: m.quantity,
          min: m.minStock,
          unit: m.unit,
          category: m.category,
          message: m.quantity === 0 ? 'MATERIAL ESGOTADO' : 'ESTOQUE MÍNIMO CRÍTICO'
        });
      }
    });

    return alerts;
  }

  checkDeploymentConflicts(deployment) {
    return false;
  }

  reinitSupabase(url, key) {
    SUPABASE_URL = url;
    SUPABASE_ANON_KEY = key;
    localStorage.setItem('fibradeploy_supabase_url', url);
    localStorage.setItem('fibradeploy_supabase_anon_key', key);
    const success = initSupabaseClient();
    if (success && supabaseClient) {
      this.syncFromSupabase();
    }
    return success;
  }

  clearSupabaseConfig() {
    SUPABASE_URL = 'https://tyywjswtnpzwoufnbenq.supabase.co';
    SUPABASE_ANON_KEY = 'SUA_SUPABASE_ANON_KEY_AQUI';
    localStorage.removeItem('fibradeploy_supabase_url');
    localStorage.removeItem('fibradeploy_supabase_anon_key');
    supabaseClient = null;
    console.log('🏠 Configurações do Supabase limpas. Retornando ao modo Local-First.');
    this.state = this.loadState();
    if (this.onSyncCallback) {
      this.onSyncCallback();
    }
  }
}

// Instantiate Global Store
const store = new FibraStore();

// ==========================================
// 2. TOAST NOTIFICATION UTILITIES
// ==========================================

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'check-circle';
  if (type === 'error') icon = 'x-circle';
  if (type === 'warning') icon = 'alert-triangle';
  if (type === 'info') icon = 'info';

  toast.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  // Entrance
  setTimeout(() => {
    toast.classList.add('show');
  }, 50);

  // Auto Dismiss
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// ==========================================
// 3. SPA ROUTING & APP VIEW MANAGER
// ==========================================

class AppView {
  constructor() {
    this.activeSection = 'dashboard';
    this.selectedDashboardDeploymentId = null;
    this.initDate();
    this.checkSession();
    this.bindEvents();
    
    // Bind sync callback to update view
    store.onSyncCallback = () => {
      this.renderAll();
    };
    
    this.renderAll();
  }

  initDate() {
    const dateEl = document.getElementById('current-date');
    if (dateEl) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      dateEl.textContent = new Date().toLocaleDateString('pt-BR', options);
    }
  }

  checkSession() {
    const loggedUser = localStorage.getItem('inuv_fibras_logged_in_user');
    const appContainer = document.querySelector('.app-container');
    const loginContainer = document.getElementById('login-container');
    
    if (loggedUser) {
      if (appContainer) appContainer.style.display = 'flex';
      if (loginContainer) loginContainer.style.display = 'none';
      
      const profileName = document.querySelector('.profile-name');
      if (profileName) {
        const users = store.getUsers();
        const user = users.find(u => u.username === loggedUser);
        profileName.textContent = user ? user.name : loggedUser;
      }
    } else {
      if (appContainer) appContainer.style.display = 'none';
      if (loginContainer) loginContainer.style.display = 'flex';
    }
  }

  handleLoginSubmit(e) {
    e.preventDefault();
    const userEl = document.getElementById('login-username');
    const passEl = document.getElementById('login-password');
    
    let isValid = true;
    isValid = this.validateField(userEl, userEl.value.trim() !== '') && isValid;
    isValid = this.validateField(passEl, passEl.value !== '') && isValid;
    
    if (!isValid) return;
    
    const username = userEl.value.trim().toLowerCase();
    const password = passEl.value;
    
    const users = store.getUsers();
    const user = users.find(u => u.username.toLowerCase() === username && u.password === password);
    
    if (user) {
      localStorage.setItem('inuv_fibras_logged_in_user', user.username);
      this.checkSession();
      showToast(`Bem-vindo, ${user.name}!`, 'success');
      
      // Limpa formulário
      userEl.value = '';
      passEl.value = '';
      this.clearFormErrors('login-form');
      
      // Renderiza todos os dados
      this.renderAll();
    } else {
      showToast('Usuário ou senha incorretos.', 'error');
    }
  }

  handleLogout() {
    localStorage.removeItem('inuv_fibras_logged_in_user');
    this.checkSession();
    showToast('Sessão encerrada com sucesso.', 'info');
  }

  handleRegisterUserSubmit(e) {
    e.preventDefault();
    const nameEl = document.getElementById('reg-name');
    const userEl = document.getElementById('reg-username');
    const passEl = document.getElementById('reg-password');
    
    let isValid = true;
    isValid = this.validateField(nameEl, nameEl.value.trim().length >= 3) && isValid;
    isValid = this.validateField(userEl, userEl.value.trim().length >= 3) && isValid;
    isValid = this.validateField(passEl, passEl.value.length >= 4) && isValid;
    
    if (!isValid) return;
    
    try {
      store.addUser({
        name: nameEl.value.trim(),
        username: userEl.value.trim().toLowerCase(),
        password: passEl.value
      });
      
      showToast('Usuário cadastrado com sucesso!', 'success');
      
      // Reset formulário
      nameEl.value = '';
      userEl.value = '';
      passEl.value = '';
      this.clearFormErrors('register-user-form');
      
      // Recarrega lista de usuários nas configurações
      this.renderUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  handleUserDelete(username) {
    if (username === 'admin') {
      showToast('Não é possível excluir o administrador padrão.', 'error');
      return;
    }
    
    if (confirm(`Deseja realmente excluir o usuário "${username}"?`)) {
      try {
        store.deleteUser(username);
        showToast('Usuário removido com sucesso.', 'info');
        this.renderUsers();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }

  renderUsers() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    
    const users = store.getUsers();
    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">Nenhum usuário cadastrado.</td></tr>`;
      return;
    }
    
    tbody.innerHTML = users.map(u => `
      <tr>
        <td style="font-weight: 600; color: var(--text-primary);">${u.name}</td>
        <td style="color: var(--text-secondary); font-family: monospace;">${u.username}</td>
        <td style="text-align: center;">
          \${u.username === 'admin' ? 
            \`<button class="btn-icon" disabled style="opacity: 0.3;" title="Administrador padrão não pode ser excluído"><i data-lucide="lock" style="width: 14px; height: 14px;"></i></button>\` : 
            \`<button class="btn-icon delete-btn" title="Excluir Usuário" onclick="appView.handleUserDelete('\${u.username}')"><i data-lucide="trash-2" style="width: 14px; height: 14px; color: #ff4d4d;"></i></button>\`
          }
        </td>
      </tr>
    `).join('');
    
    // Atualiza ícones lucide
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  bindEvents() {
    // SPA Tabs Navigation routing
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = link.getAttribute('data-target');
        this.navigate(target);
      });
    });

    // --- Material Modal Bindings ---
    const btnOpenAddMaterial = document.getElementById('btn-open-add-material');
    const btnCloseMaterialModal = document.getElementById('btn-close-material-modal');
    const btnCancelMaterialModal = document.getElementById('btn-cancel-material-modal');
    const materialForm = document.getElementById('material-form');

    if (btnOpenAddMaterial) btnOpenAddMaterial.addEventListener('click', () => this.openMaterialModal());
    if (btnCloseMaterialModal) btnCloseMaterialModal.addEventListener('click', () => this.closeMaterialModal());
    if (btnCancelMaterialModal) btnCancelMaterialModal.addEventListener('click', () => this.closeMaterialModal());
    if (materialForm) materialForm.addEventListener('submit', (e) => this.handleMaterialSubmit(e));

    // --- Inventory Transaction Modal Bindings ---
    const btnOpenTxn = document.getElementById('btn-open-inventory-transaction');
    const btnCloseTxn = document.getElementById('btn-close-transaction-modal');
    const btnCancelTxn = document.getElementById('btn-cancel-transaction-modal');
    const txnForm = document.getElementById('transaction-form');

    if (btnOpenTxn) btnOpenTxn.addEventListener('click', () => this.openInventoryTransactionModal());
    if (btnCloseTxn) btnCloseTxn.addEventListener('click', () => this.closeInventoryTransactionModal());
    if (btnCancelTxn) btnCancelTxn.addEventListener('click', () => this.closeInventoryTransactionModal());
    if (txnForm) txnForm.addEventListener('submit', (e) => this.handleTransactionSubmit(e));

    // --- Service Modal Bindings ---
    const btnOpenAddService = document.getElementById('btn-open-add-service');
    const btnCloseServiceModal = document.getElementById('btn-close-service-modal');
    const btnCancelServiceModal = document.getElementById('btn-cancel-service-modal');
    const serviceForm = document.getElementById('service-form');

    if (btnOpenAddService) btnOpenAddService.addEventListener('click', () => this.openServiceModal());
    if (btnCloseServiceModal) btnCloseServiceModal.addEventListener('click', () => this.closeServiceModal());
    if (btnCancelServiceModal) btnCancelServiceModal.addEventListener('click', () => this.closeServiceModal());
    if (serviceForm) serviceForm.addEventListener('submit', (e) => this.handleServiceSubmit(e));

    // --- Deployment Modal Bindings ---
    const btnOpenAddDeployment = document.getElementById('btn-open-add-deployment');
    const btnCloseDeploymentModal = document.getElementById('btn-close-deployment-modal');
    const btnCancelDeploymentModal = document.getElementById('btn-cancel-deployment-modal');
    const deploymentForm = document.getElementById('deployment-form');

    if (btnOpenAddDeployment) btnOpenAddDeployment.addEventListener('click', () => this.openDeploymentModal());
    if (btnCloseDeploymentModal) btnCloseDeploymentModal.addEventListener('click', () => this.closeDeploymentModal());
    if (btnCancelDeploymentModal) btnCancelDeploymentModal.addEventListener('click', () => this.closeDeploymentModal());
    if (deploymentForm) deploymentForm.addEventListener('submit', (e) => this.handleDeploymentSubmit(e));

    // --- Planning Modal Bindings ---
    const btnClosePlanningModal = document.getElementById('btn-close-planning-modal');
    const btnClosePlanningModalFooter = document.getElementById('btn-close-planning-modal-footer');
    const planningForm = document.getElementById('planning-form');
    const selectPlanningMaterial = document.getElementById('planning-material-id');
    const planningQtyInput = document.getElementById('planning-qty');

    if (btnClosePlanningModal) btnClosePlanningModal.addEventListener('click', () => this.closePlanningModal());
    if (btnClosePlanningModalFooter) btnClosePlanningModalFooter.addEventListener('click', () => this.closePlanningModal());
    if (planningForm) planningForm.addEventListener('submit', (e) => this.handlePlanningSubmit(e));

    // Labor form binding
    const laborForm = document.getElementById('labor-form');
    if (laborForm) laborForm.addEventListener('submit', (e) => this.handleLaborSubmit(e));

    // Watch material select inside planning to display unit info
    if (selectPlanningMaterial) {
      selectPlanningMaterial.addEventListener('change', (e) => {
        this.updatePlanningFormHelper(e.target.value);
        this.checkLivePlanningConflict();
      });
    }

    // Watch quantity input inside planning to show live warning alerts
    if (planningQtyInput) {
      planningQtyInput.addEventListener('input', () => {
        this.checkLivePlanningConflict();
      });
    }

    // --- Search & Filters Bindings ---
    // Materials / Inventory
    const invSearchInput = document.getElementById('inv-search');
    const invTypeFilter = document.getElementById('inv-type-filter');
    const invCatFilter = document.getElementById('inv-category-filter');
    const invBtnClear = document.getElementById('btn-inv-clear-filters');
    
    if (invSearchInput) invSearchInput.addEventListener('input', () => this.renderStockList());
    if (invTypeFilter) invTypeFilter.addEventListener('change', () => this.renderStockList());
    if (invCatFilter) invCatFilter.addEventListener('change', () => this.renderStockList());
    if (invBtnClear) {
      invBtnClear.addEventListener('click', () => {
        if (invSearchInput) invSearchInput.value = '';
        if (invTypeFilter) invTypeFilter.value = 'todos';
        if (invCatFilter) invCatFilter.value = 'todos';
        this.renderStockList();
      });
    }
    // Deployments
    const depSearch = document.getElementById('deployment-search');
    const depFilter = document.getElementById('deployment-status-filter');
    if (depSearch) depSearch.addEventListener('input', () => this.renderDeploymentsList());
    if (depFilter) depFilter.addEventListener('change', () => this.renderDeploymentsList());

    // --- Phase 3 Bindings ---
    // Deliveries
    const deliveryForm = document.getElementById('delivery-form');
    if (deliveryForm) deliveryForm.addEventListener('submit', (e) => this.handleDeliverySubmit(e));

    const selectDeliveryMaterial = document.getElementById('delivery-material-id');
    if (selectDeliveryMaterial) {
      selectDeliveryMaterial.addEventListener('change', (e) => {
        this.updateDeliveryFormHelper(e.target.value);
      });
    }

    const deliveryEditForm = document.getElementById('delivery-edit-form');
    if (deliveryEditForm) deliveryEditForm.addEventListener('submit', (e) => this.handleDeliveryEditSubmit(e));

    const btnCloseDelEdit = document.getElementById('btn-close-delivery-edit-modal');
    if (btnCloseDelEdit) btnCloseDelEdit.addEventListener('click', () => this.closeDeliveryEditModal());

    const btnCancelDelEdit = document.getElementById('btn-cancel-delivery-edit-modal');
    if (btnCancelDelEdit) btnCancelDelEdit.addEventListener('click', () => this.closeDeliveryEditModal());

    // Campo - Consumo Real
    const consumeDepSelect = document.getElementById('consume-deployment-id');
    if (consumeDepSelect) {
      consumeDepSelect.addEventListener('change', (e) => {
        this.handleConsumeDeploymentChange(e.target.value);
      });
    }

    const consumeTeamSelect = document.getElementById('consume-team');
    if (consumeTeamSelect) {
      consumeTeamSelect.addEventListener('change', (e) => {
        const depId = document.getElementById('consume-deployment-id').value;
        this.handleConsumeTeamChange(depId, e.target.value);
      });
    }

    const consumeMatSelect = document.getElementById('consume-material-id');
    if (consumeMatSelect) {
      consumeMatSelect.addEventListener('change', (e) => {
        const depId = document.getElementById('consume-deployment-id').value;
        const team = document.getElementById('consume-team').value;
        this.handleConsumeMaterialChange(depId, team, e.target.value);
      });
    }

    const consumptionForm = document.getElementById('consumption-form');
    if (consumptionForm) consumptionForm.addEventListener('submit', (e) => this.handleConsumptionSubmit(e));

    // Campo - Devolução
    const returnDepSelect = document.getElementById('return-deployment-id');
    if (returnDepSelect) {
      returnDepSelect.addEventListener('change', (e) => {
        this.handleReturnDeploymentChange(e.target.value);
      });
    }

    const returnTeamSelect = document.getElementById('return-team');
    if (returnTeamSelect) {
      returnTeamSelect.addEventListener('change', (e) => {
        const depId = document.getElementById('return-deployment-id').value;
        this.handleReturnTeamChange(depId, e.target.value);
      });
    }

    const returnMatSelect = document.getElementById('return-material-id');
    if (returnMatSelect) {
      returnMatSelect.addEventListener('change', (e) => {
        const depId = document.getElementById('return-deployment-id').value;
        const team = document.getElementById('return-team').value;
        this.handleReturnMaterialChange(depId, team, e.target.value);
      });
    }

    const returnForm = document.getElementById('return-form');
    if (returnForm) returnForm.addEventListener('submit', (e) => this.handleReturnSubmit(e));

    // Campo - Pagamento de Mão de Obra
    const payDepSelect = document.getElementById('pay-deployment-id');
    if (payDepSelect) {
      payDepSelect.addEventListener('change', (e) => {
        this.handlePayDeploymentChange(e.target.value);
      });
    }

    const laborPaymentForm = document.getElementById('labor-payment-form');
    if (laborPaymentForm) {
      laborPaymentForm.addEventListener('submit', (e) => {
        this.handleLaborPaymentSubmit(e);
      });
    }

    // Relatórios
    const reportDepSelect = document.getElementById('report-deployment-id');
    if (reportDepSelect) {
      reportDepSelect.addEventListener('change', (e) => {
        this.renderReports(e.target.value);
      });
    }

    // Top active deployment selector change event
    const topSelectEl = document.getElementById('top-deployment-select');
    if (topSelectEl) {
      topSelectEl.addEventListener('change', (e) => {
        this.selectedDashboardDeploymentId = e.target.value;
        this.renderAll();
      });
    }

    // --- Supabase Config Bindings ---
    const configForm = document.getElementById('supabase-config-form');
    const btnClearConfig = document.getElementById('btn-clear-supabase-config');

    if (configForm) {
      configForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = document.getElementById('config-supabase-url').value.trim();
        const key = document.getElementById('config-supabase-key').value.trim();

        if (!url || !url.startsWith('http')) {
          showToast('URL da API inválida.', 'error');
          return;
        }
        if (!key) {
          showToast('A chave Anon é obrigatória.', 'error');
          return;
        }

        const success = store.reinitSupabase(url, key);
        if (success) {
          showToast('Conectado à nuvem Supabase com sucesso!', 'success');
          this.renderSupabaseSettings();
        } else {
          showToast('Erro ao inicializar o cliente Supabase. Verifique os dados.', 'error');
        }
      });
    }

    if (btnClearConfig) {
      btnClearConfig.addEventListener('click', () => {
        store.clearSupabaseConfig();
        showToast('Configurações limpas. Retornado ao modo local.', 'info');
        this.renderSupabaseSettings();
      });
    }

    // --- Teams Form Bindings ---
    const teamForm = document.getElementById('team-form');
    if (teamForm) {
      teamForm.addEventListener('submit', (e) => this.handleTeamSubmit(e));
    }

    const btnCancelTeam = document.getElementById('btn-cancel-team');
    if (btnCancelTeam) {
      btnCancelTeam.addEventListener('click', () => this.closeTeamEdit());
    }

    const btnResetData = document.getElementById('btn-reset-app-data');
    if (btnResetData) {
      btnResetData.addEventListener('click', async () => {
        if (confirm('Deseja realmente limpar todos os lançamentos, consumos, entregas e devoluções? Esta ação não pode ser desfeita.')) {
          try {
            // 1. Wipe local store memory state
            store.state.deployments = [];
            store.state.deliveries = [];
            store.state.consumptions = [];
            store.state.returns = [];
            store.state.expenses = [];
            store.state.laborPayments = [];
            store.saveState();

            // 2. Wipe Supabase tables if connected
            if (supabaseClient) {
              showToast('Limpando dados na nuvem...', 'info');
              const { error: errRet } = await supabaseClient.from('returns').delete().neq('id', '');
              if (errRet) console.warn('Erro ao limpar returns:', errRet);

              const { error: errCons } = await supabaseClient.from('consumptions').delete().neq('id', '');
              if (errCons) console.warn('Erro ao limpar consumptions:', errCons);

              const { error: errDel } = await supabaseClient.from('deliveries').delete().neq('id', '');
              if (errDel) console.warn('Erro ao limpar deliveries:', errDel);

              const { error: errPlan } = await supabaseClient.from('planned_materials').delete().neq('id', '');
              if (errPlan) console.warn('Erro ao limpar planned_materials:', errPlan);

              const { error: errDep } = await supabaseClient.from('deployments').delete().neq('id', '');
              if (errDep) console.warn('Erro ao limpar deployments:', errDep);

              try {
                await supabaseClient.from('expenses').delete().neq('id', '');
              } catch (e) {
                console.warn('Erro ao limpar despesas no Supabase:', e);
              }
              try {
                await supabaseClient.from('labor_payments').delete().neq('id', '');
              } catch (e) {
                console.warn('Erro ao limpar labor_payments no Supabase:', e);
              }
            }

            showToast('Todos os lançamentos, consumos e despesas foram limpos com sucesso!', 'success');
            
            // Reset selected dashboard deployment ID
            this.selectedDashboardDeploymentId = null;
            
            this.renderAll();
          } catch (err) {
            showToast('Erro ao limpar dados: ' + err.message, 'error');
          }
        }
      });
    }

    const btnResetStock = document.getElementById('btn-reset-stock-data');
    if (btnResetStock) {
      btnResetStock.addEventListener('click', async () => {
        if (confirm('ATENÇÃO: Deseja realmente apagar TODOS os materiais em estoque? Para manter a integridade do banco de dados, todos os lançamentos, consumos, entregas, devoluções e despesas também serão apagados permanentemente.')) {
          try {
            // 1. Wipe local store memory state
            store.state.materials = [];
            store.state.deployments = [];
            store.state.deliveries = [];
            store.state.consumptions = [];
            store.state.returns = [];
            store.state.expenses = [];
            store.state.laborPayments = [];
            store.saveState();

            // 2. Wipe Supabase tables if connected
            if (supabaseClient) {
              showToast('Limpando dados na nuvem...', 'info');
              const { error: errRet } = await supabaseClient.from('returns').delete().neq('id', '');
              if (errRet) console.warn('Erro ao limpar returns:', errRet);

              const { error: errCons } = await supabaseClient.from('consumptions').delete().neq('id', '');
              if (errCons) console.warn('Erro ao limpar consumptions:', errCons);

              const { error: errDel } = await supabaseClient.from('deliveries').delete().neq('id', '');
              if (errDel) console.warn('Erro ao limpar deliveries:', errDel);

              const { error: errPlan } = await supabaseClient.from('planned_materials').delete().neq('id', '');
              if (errPlan) console.warn('Erro ao limpar planned_materials:', errPlan);

              const { error: errDep } = await supabaseClient.from('deployments').delete().neq('id', '');
              if (errDep) console.warn('Erro ao limpar deployments:', errDep);

              const { error: errMat } = await supabaseClient.from('materials').delete().neq('id', '');
              if (errMat) console.warn('Erro ao limpar materials:', errMat);

              try {
                await supabaseClient.from('expenses').delete().neq('id', '');
              } catch (e) {
                console.warn('Erro ao limpar despesas no Supabase:', e);
              }
              try {
                await supabaseClient.from('labor_payments').delete().neq('id', '');
              } catch (e) {
                console.warn('Erro ao limpar labor_payments no Supabase:', e);
              }
            }

            showToast('Estoque, lançamentos e despesas limpos com sucesso!', 'success');
            
            // Reset selected dashboard deployment ID
            this.selectedDashboardDeploymentId = null;
            
            this.renderAll();
          } catch (err) {
            showToast('Erro ao limpar estoque: ' + err.message, 'error');
          }
        }
      });
    }

    // --- Categories & Units Modal Bindings ---
    const btnOpenCategories = document.getElementById('btn-open-categories');
    const btnCloseCategories = document.getElementById('btn-close-categories-modal');
    const btnCloseCategoriesFooter = document.getElementById('btn-close-categories-modal-footer');
    const btnAddCategory = document.getElementById('btn-add-category');
    const newCategoryInput = document.getElementById('new-category-name');

    if (btnOpenCategories) btnOpenCategories.addEventListener('click', () => this.openCategoriesModal());
    if (btnCloseCategories) btnCloseCategories.addEventListener('click', () => this.closeCategoriesModal());
    if (btnCloseCategoriesFooter) btnCloseCategoriesFooter.addEventListener('click', () => this.closeCategoriesModal());
    if (btnAddCategory) btnAddCategory.addEventListener('click', () => this.handleAddCategory());
    if (newCategoryInput) newCategoryInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleAddCategory();
    });

    const btnOpenUnits = document.getElementById('btn-open-units');
    const btnCloseUnits = document.getElementById('btn-close-units-modal');
    const btnCloseUnitsFooter = document.getElementById('btn-close-units-modal-footer');
    const btnAddUnit = document.getElementById('btn-add-unit');
    const newUnitInput = document.getElementById('new-unit-name');

    if (btnOpenUnits) btnOpenUnits.addEventListener('click', () => this.openUnitsModal());
    if (btnCloseUnits) btnCloseUnits.addEventListener('click', () => this.closeUnitsModal());
    if (btnCloseUnitsFooter) btnCloseUnitsFooter.addEventListener('click', () => this.closeUnitsModal());
    if (btnAddUnit) btnAddUnit.addEventListener('click', () => this.handleAddUnit());
    if (newUnitInput) newUnitInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleAddUnit();
    });

    // --- Login Form Binding ---
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLoginSubmit(e));
    }

    // --- Logout Button Binding ---
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleLogout();
      });
    }

    // --- User Registration Form Binding ---
    const registerUserForm = document.getElementById('register-user-form');
    if (registerUserForm) {
      registerUserForm.addEventListener('submit', (e) => this.handleRegisterUserSubmit(e));
    }

    // --- Central de Custos Form Binding ---
    const expenseForm = document.getElementById('expense-form');
    if (expenseForm) {
      expenseForm.addEventListener('submit', (e) => this.handleExpenseSubmit(e));
    }
  }

  navigate(sectionId) {
    this.activeSection = sectionId;
    
    // Switch nav link active classes
    document.querySelectorAll('.nav-link').forEach(link => {
      if (link.getAttribute('data-target') === sectionId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Switch section display
    document.querySelectorAll('.app-section').forEach(sec => {
      if (sec.id === `${sectionId}-section`) {
        sec.classList.add('active');
      } else {
        sec.classList.remove('active');
      }
    });

    // Update Titles
    const titleEl = document.getElementById('page-title');
    const subtitleEl = document.getElementById('page-subtitle');
    
    if (sectionId === 'dashboard') {
      titleEl.textContent = 'Painel de Controle';
      subtitleEl.textContent = 'Visão geral do estoque e operações de fibra óptica';
    } else if (sectionId === 'estoque') {
      titleEl.textContent = 'Gestão de Estoque';
      subtitleEl.textContent = 'Cadastro, edição e controle de níveis mínimos de materiais';
    } else if (sectionId === 'lancamentos') {
      titleEl.textContent = 'Planejamento';
      subtitleEl.textContent = 'Gestão técnica de obras, cronogramas de implantação e planejamento de materiais';
    } else if (sectionId === 'entregas') {
      titleEl.textContent = 'Entregas para Lançadores';
      subtitleEl.textContent = 'Gestão e despacho de materiais de fibra óptica para equipes de campo';
    } else if (sectionId === 'campo') {
      titleEl.textContent = 'Operações em Campo';
      subtitleEl.textContent = 'Reporte de consumo diário, controle de devoluções e saldo em posse das equipes';
    } else if (sectionId === 'relatorios') {
      titleEl.textContent = 'Relatórios e Auditoria';
      subtitleEl.textContent = 'Análise financeira por obra, controle de divergências orçamentárias e custos técnicos';
    } else if (sectionId === 'custos') {
      titleEl.textContent = 'Central de Custos';
      subtitleEl.textContent = 'Métricas financeiras integradas, controle de despesas extras e orçamentos de obras';
    } else if (sectionId === 'configuracoes') {
      titleEl.textContent = 'Configurações de Sincronização';
      subtitleEl.textContent = 'Ajuste a conexão em tempo real com o banco de dados Supabase na nuvem';
    } else if (sectionId === 'equipes') {
      titleEl.textContent = 'Gestão de Equipes';
      subtitleEl.textContent = 'Cadastro, edição e controle de equipes de campo e seus encarregados';
    }

    // Show/hide top deployment selector — only on dashboard
    const topSelectorWrapper = document.querySelector('.top-deployment-selector-wrapper');
    if (topSelectorWrapper) {
      topSelectorWrapper.style.display = sectionId === 'dashboard' ? 'flex' : 'none';
    }

    this.renderAll();
  }

  renderAll() {
    this.renderDashboardMetrics();
    
    if (this.activeSection === 'estoque') {
      this.renderStockList();
    } else if (this.activeSection === 'lancamentos') {
      this.renderDeploymentsList();
    } else if (this.activeSection === 'entregas') {
      this.renderDeliveries();
      this.populateDeliveryDropdowns();
    } else if (this.activeSection === 'campo') {
      this.renderFieldOps();
      this.populateCampoDropdowns();
    } else if (this.activeSection === 'relatorios') {
      this.populateReportDropdown();
      const depSelect = document.getElementById('report-deployment-id');
      this.renderReports(depSelect ? depSelect.value : '');
    } else if (this.activeSection === 'configuracoes') {
      this.renderSupabaseSettings();
      this.renderUsers();
    } else if (this.activeSection === 'equipes') {
      this.renderTeams();
    } else if (this.activeSection === 'servicos') {
      this.renderServicesList();
    } else if (this.activeSection === 'custos') {
      this.renderCostCenter();
    }

    if (window.lucide) lucide.createIcons();
  }

  renderSupabaseSettings() {
    const urlInput = document.getElementById('config-supabase-url');
    const keyInput = document.getElementById('config-supabase-key');
    const cardEl = document.getElementById('db-status-card');
    const titleEl = document.getElementById('db-status-title');
    const descEl = document.getElementById('db-status-desc');
    const badgeEl = document.getElementById('db-status-badge');
    const iconEl = document.getElementById('db-status-icon');
    const iconBoxEl = document.getElementById('db-status-icon-box');

    if (urlInput) urlInput.value = SUPABASE_URL;
    if (keyInput) keyInput.value = SUPABASE_ANON_KEY === 'SUA_SUPABASE_ANON_KEY_AQUI' ? '' : SUPABASE_ANON_KEY;

    if (supabaseClient) {
      if (cardEl) {
        cardEl.className = 'alert-item success-alert';
        cardEl.style.backgroundColor = 'rgba(63, 204, 221, 0.08)';
      }
      if (titleEl) titleEl.textContent = 'Conectado à Nuvem Supabase';
      if (descEl) descEl.textContent = 'Sincronização em nuvem ativa em tempo real! Todas as alterações no estoque, obras e auditorias são persistidas e compartilhadas instantaneamente.';
      if (badgeEl) {
        badgeEl.className = 'badge badge-green';
        badgeEl.textContent = 'Cloud Active';
      }
      if (iconEl) {
        iconEl.className = 'lucide-database';
        iconEl.setAttribute('data-lucide', 'database');
        iconEl.style.color = '#3FCCDD';
      }
      if (iconBoxEl) iconBoxEl.style.backgroundColor = 'rgba(63, 204, 221, 0.15)';
    } else {
      if (cardEl) {
        cardEl.className = 'alert-item warning-alert';
        cardEl.style.backgroundColor = 'rgba(212, 237, 26, 0.08)';
      }
      if (titleEl) titleEl.textContent = 'Modo Local-First (Offline/LocalStorage)';
      if (descEl) descEl.textContent = 'Os dados estão sendo armazenados localmente neste navegador. Insira a sua Anon Key abaixo para ativar o banco de dados na nuvem.';
      if (badgeEl) {
        badgeEl.className = 'badge badge-amber';
        badgeEl.textContent = 'LocalStorage';
      }
      if (iconEl) {
        iconEl.className = 'lucide-database';
        iconEl.setAttribute('data-lucide', 'database');
        iconEl.style.color = '#D4ED1A';
      }
      if (iconBoxEl) iconBoxEl.style.backgroundColor = 'rgba(212, 237, 26, 0.15)';
    }
    
    if (window.lucide) lucide.createIcons();
  }

  // --- Render Teams (Equipes) ---
  renderTeams() {
    const tbody = document.getElementById('teams-tbody');
    const emptyState = document.getElementById('teams-empty-state');
    if (!tbody || !emptyState) return;

    const list = store.getTeams();

    if (list.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    tbody.innerHTML = list.map(item => {
      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(99, 102, 241, 0.1); color: var(--color-indigo);">
                <i data-lucide="users" style="width: 16px; height: 16px;"></i>
              </div>
              <span style="font-weight: 600; color: var(--text-primary);">${item.name}</span>
            </div>
          </td>
          <td>
            <span style="font-weight: 500; color: var(--text-secondary);">${item.responsible}</span>
          </td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button class="btn-icon" title="Editar Equipe" onclick="appView.openTeamEdit('${item.id}')">
                <i data-lucide="pencil"></i>
              </button>
              <button class="btn-icon delete-btn" title="Excluir Equipe" onclick="appView.handleTeamDelete('${item.id}')">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  // --- Render Central de Custos ---
  renderCostCenter() {
    const materials = store.state.materials || [];
    const deliveries = store.state.deliveries || [];
    const returns = store.state.returns || [];
    const consumptions = store.state.consumptions || [];
    const expenses = store.getExpenses();
    const laborPayments = store.getLaborPayments();
    let deployments = store.getDeployments();

    // FILTERS
    const searchFilter = document.getElementById('cost-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('cost-status-filter')?.value || 'todos';

    // Populate deployments if select exists and is empty
    const depSelect = document.getElementById('cost-deployment-filter');
    if (depSelect && depSelect.options.length <= 1) {
      depSelect.innerHTML = '<option value="todos">Todas as Obras (Lançamentos)</option>' + 
        store.getDeployments().map(d => `<option value="${d.id}">${d.city ? `${d.city} (${d.name})` : d.name}</option>`).join('');
    }
    const depFilter = depSelect?.value || 'todos';

    // Populate responsibles if select exists and is empty
    const respSelect = document.getElementById('cost-responsible-filter');
    if (respSelect && respSelect.options.length <= 1) {
      const uniqueResp = [...new Set(store.getDeployments().map(d => d.responsible).filter(Boolean))];
      respSelect.innerHTML = '<option value="todos">Todos Responsáveis</option>' + 
        uniqueResp.map(r => `<option value="${r}">${r}</option>`).join('');
    }
    const respFilter = respSelect?.value || 'todos';

    if (searchFilter) {
      deployments = deployments.filter(d => (d.name.toLowerCase().includes(searchFilter) || (d.city || '').toLowerCase().includes(searchFilter)));
    }
    if (statusFilter !== 'todos') {
      deployments = deployments.filter(d => d.status === statusFilter);
    }
    if (respFilter !== 'todos') {
      deployments = deployments.filter(d => d.responsible === respFilter);
    }
    if (depFilter !== 'todos') {
      deployments = deployments.filter(d => d.id === depFilter);
    }

    // 1. TOP CARDS CALCS
    const stockVal = materials.reduce((sum, m) => sum + (m.quantity * m.unitValue), 0);
    const depIds = deployments.map(d => d.id);
    const scopeDeliveries = deliveries.filter(d => depIds.includes(d.deploymentId));
    const scopeReturns = returns.filter(r => depIds.includes(r.deploymentId));
    const scopeConsumptions = consumptions.filter(c => depIds.includes(c.deploymentId));
    const scopeExpenses = expenses.filter(e => depIds.includes(e.deploymentId));
    const scopeLabor = laborPayments.filter(lp => depIds.includes(lp.deploymentId));

    const deliveredVal = scopeDeliveries.reduce((sum, d) => {
      const mat = store.getMaterial(d.materialId);
      return sum + (d.quantity * (mat ? mat.unitValue : d.unitValue || 0));
    }, 0);
    const returnedVal = scopeReturns.reduce((sum, r) => {
      const mat = store.getMaterial(r.materialId);
      return sum + (r.quantity * (mat ? mat.unitValue : r.unitValue || 0));
    }, 0);
    const consumedVal = scopeConsumptions.reduce((sum, c) => {
      const mat = store.getMaterial(c.materialId);
      return sum + (c.quantity * (mat ? mat.unitValue : c.unitValue || 0));
    }, 0);

    const transitVal = Math.max(0, deliveredVal - returnedVal - consumedVal);
    const laborVal = scopeLabor.reduce((sum, lp) => sum + lp.value, 0);
    const extraExpensesVal = scopeExpenses.reduce((sum, e) => sum + e.value, 0);
    
    const inventoryTransactions = store.getInventoryTransactions() || [];
    const scopeOpConsumptions = inventoryTransactions.filter(t => t.type === 'consumo_obra' && depIds.includes(t.deploymentId));
    const opConsumedVal = scopeOpConsumptions.reduce((sum, t) => sum + (t.value || 0), 0);

    const totalCostVal = consumedVal + extraExpensesVal + laborVal + opConsumedVal;
    
    // Labor Planned (Global) -> Total de M.O orçada
    const laborPlannedVal = deployments.reduce((sum, d) => sum + (d.plannedLaborItems || []).reduce((s, li) => s + (li.quantity * li.unitValue), 0), 0);

    // 2. SECONDARY CARDS CALCS
    const activeDepsCount = deployments.filter(d => d.status === 'em_andamento').length;
    let globalPlanned = 0;
    let overBudgetCount = 0;
    
    const tableRowsData = deployments.map(d => {
      const dConsumptions = consumptions.filter(c => c.deploymentId === d.id);
      const dConsumedVal = dConsumptions.reduce((sum, c) => {
        const mat = store.getMaterial(c.materialId);
        return sum + (c.quantity * (mat ? mat.unitValue : c.unitValue || 0));
      }, 0);
      
      const dExpensesVal = expenses.filter(exp => exp.deploymentId === d.id).reduce((sum, exp) => sum + exp.value, 0);
      const dLaborVal = laborPayments.filter(lp => lp.deploymentId === d.id).reduce((sum, lp) => sum + lp.value, 0);
      
      const dOpConsumptions = inventoryTransactions.filter(t => t.type === 'consumo_obra' && t.deploymentId === d.id);
      const dOpConsumedVal = dOpConsumptions.reduce((sum, t) => sum + (t.value || 0), 0);

      const totalSpent = dConsumedVal + dExpensesVal + dLaborVal + dOpConsumedVal;
      const budgetVal = store.getDeploymentTotalCost(d);
      
      globalPlanned += budgetVal;
      if (budgetVal > 0 && totalSpent > budgetVal) overBudgetCount++;
      
      return {
        id: d.id,
        name: d.city ? `${d.city} (${d.name})` : d.name,
        budget: budgetVal,
        materials: dConsumedVal,
        labor: dLaborVal,
        expenses: dExpensesVal + dOpConsumedVal, // Add op consumption to expenses for table rendering
        total: totalSpent,
        balance: budgetVal - totalSpent
      };
    });

    const avgDepCost = deployments.length > 0 ? totalCostVal / deployments.length : 0;
    const globalBalance = globalPlanned - totalCostVal;
    const globalPct = globalPlanned > 0 ? Math.min(Math.round((totalCostVal / globalPlanned) * 100), 999) : 0;

    // Inject TOP CARDS
    const inject = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const fmt = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    inject('cost-stock-val', fmt(stockVal));
    inject('cost-transit-val', fmt(transitVal));
    inject('cost-consumed-val', fmt(consumedVal));
    inject('cost-labor-val', fmt(laborPlannedVal));
    inject('cost-expenses-val', fmt(extraExpensesVal));
    inject('cost-total-val', fmt(totalCostVal));

    // Inject SECONDARY CARDS
    inject('cost-active-deps', activeDepsCount);
    inject('cost-over-budget', overBudgetCount);
    inject('cost-avg-dep', fmt(avgDepCost));
    inject('cost-global-balance', fmt(globalBalance));
    inject('cost-global-planned', fmt(globalPlanned));
    inject('cost-global-pct', `${globalPct}%`);
    
    const balanceEl = document.getElementById('cost-global-balance');
    if (balanceEl) balanceEl.className = `card-sm-value ${globalBalance < 0 ? 'text-red' : 'text-green'}`;

    // 3. TABLE RENDERING
    const tbody = document.getElementById('cost-deployment-table-body');
    if (tbody) {
      if (tableRowsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px;">Nenhum dado encontrado para os filtros.</td></tr>`;
      } else {
        tbody.innerHTML = tableRowsData.map(r => {
          let badge = '';
          if (r.budget === 0) badge = '<span class="badge badge-gray">Sem Planej.</span>';
          else if (r.total > r.budget) badge = '<span class="badge badge-red" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2);">Estourado</span>';
          else if (r.total >= r.budget * 0.9) badge = '<span class="badge badge-yellow" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.2);">Atenção</span>';
          else badge = '<span class="badge badge-green" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2);">Dentro</span>';

          const balColor = r.balance < 0 ? 'var(--color-danger)' : 'var(--text-primary)';
          
          return `
            <tr>
              <td><div style="font-weight: 600;">${r.name}</div></td>
              <td style="text-align: right;">${fmt(r.budget)}</td>
              <td style="text-align: right;">${fmt(r.materials)}</td>
              <td style="text-align: right;">${fmt(r.labor)}</td>
              <td style="text-align: right;">${fmt(r.expenses)}</td>
              <td style="text-align: right; font-weight: 700; color: var(--primary-color);">${fmt(r.total)}</td>
              <td style="text-align: right; color: ${balColor}; font-weight: 600;">${fmt(r.balance)}</td>
              <td style="text-align: center;">${badge}</td>
              <td style="text-align: center;">
                <button class="btn-icon" title="Ver Detalhes" onclick="appView.navigate('lancamentos'); setTimeout(()=>appView.openDeploymentModal('${r.id}'), 100);"><i data-lucide="eye"></i></button>
                <button class="btn-icon" title="Nova Despesa" onclick="appView.openAddExpenseModal('${r.id}')"><i data-lucide="receipt"></i></button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // 4. CHARTS RENDERING
    if (typeof Chart !== 'undefined') {
      const barCanvas = document.getElementById('costBarChart');
      if (barCanvas) {
        if (window.costBarChartInstance) window.costBarChartInstance.destroy();
        const sortedForBar = [...tableRowsData].sort((a,b) => b.total - a.total).slice(0, 10);
        window.costBarChartInstance = new Chart(barCanvas, {
          type: 'bar',
          data: {
            labels: sortedForBar.map(r => r.name.length > 15 ? r.name.substring(0, 15) + '...' : r.name),
            datasets: [
              { label: 'Realizado', data: sortedForBar.map(r => r.total), backgroundColor: '#3b82f6', borderRadius: 4 },
              { label: 'Orçado', data: sortedForBar.map(r => r.budget), backgroundColor: 'rgba(203, 213, 225, 0.6)', borderRadius: 4 }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } }
        });
      }

      const donutCanvas = document.getElementById('costDonutChart');
      if (donutCanvas) {
        if (window.costDonutChartInstance) window.costDonutChartInstance.destroy();
        window.costDonutChartInstance = new Chart(donutCanvas, {
          type: 'doughnut',
          data: {
            labels: ['Materiais', 'Mão de Obra', 'Despesas Extras'],
            datasets: [{ data: [consumedVal, laborVal, extraExpensesVal], backgroundColor: ['#3b82f6', '#8b5cf6', '#f59e0b'], borderWidth: 0 }]
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right' } } }
        });
      }
    }

    // 5. EVENT BINDINGS (Deferred to avoid double bindings)
    const searchEl = document.getElementById('cost-search');
    if (searchEl && !searchEl.dataset.bound) { searchEl.addEventListener('input', () => this.renderCostCenter()); searchEl.dataset.bound = 'true'; }
    const statusEl = document.getElementById('cost-status-filter');
    if (statusEl && !statusEl.dataset.bound) { statusEl.addEventListener('change', () => this.renderCostCenter()); statusEl.dataset.bound = 'true'; }
    const respEl = document.getElementById('cost-responsible-filter');
    if (respEl && !respEl.dataset.bound) { respEl.addEventListener('change', () => this.renderCostCenter()); respEl.dataset.bound = 'true'; }
    const depFilterEl = document.getElementById('cost-deployment-filter');
    if (depFilterEl && !depFilterEl.dataset.bound) { depFilterEl.addEventListener('change', () => this.renderCostCenter()); depFilterEl.dataset.bound = 'true'; }
    
    const btnClear = document.getElementById('btn-cost-clear-filters');
    if (btnClear && !btnClear.dataset.bound) {
      btnClear.addEventListener('click', () => {
        if (searchEl) searchEl.value = '';
        if (statusEl) statusEl.value = 'todos';
        if (respEl) respEl.value = 'todos';
        if (depFilterEl) depFilterEl.value = 'todos';
        this.renderCostCenter();
      });
      btnClear.dataset.bound = 'true';
    }
    const btnExport = document.getElementById('btn-export-cost-report');
    if (btnExport && !btnExport.dataset.bound) {
      btnExport.addEventListener('click', () => {
        const header = "Obra/Lancamento,Limite Orcamento,Materiais(Real),Mao de Obra,Despesas Extras,Custo Total,Saldo\n";
        const rows = tableRowsData.map(r => `"${r.name}",${r.budget},${r.materials},${r.labor},${r.expenses},${r.total},${r.balance}`).join("\n");
        const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `relatorio_custos_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
      });
      btnExport.dataset.bound = 'true';
    }
    const btnNewBud = document.getElementById('btn-open-cost-planning');
    if (btnNewBud && !btnNewBud.dataset.bound) {
      btnNewBud.addEventListener('click', () => { this.navigate('lancamentos'); setTimeout(()=>this.openDeploymentModal(), 100); });
      btnNewBud.dataset.bound = 'true';
    }
    const btnNewExp = document.getElementById('btn-open-cost-expense');
    if (btnNewExp && !btnNewExp.dataset.bound) {
      btnNewExp.addEventListener('click', () => this.openAddExpenseModal());
      btnNewExp.dataset.bound = 'true';
    }

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  openTeamEdit(id) {
    const team = store.getTeam(id);
    if (!team) return;

    this.clearFormErrors('team-form');

    document.getElementById('edit-team-id').value = team.id;
    document.getElementById('team-name').value = team.name;
    document.getElementById('team-responsible').value = team.responsible;

    document.getElementById('team-form-title').textContent = 'Editar Equipe';
    document.getElementById('btn-team-submit-text').textContent = 'Salvar Alterações';
    
    const cancelBtn = document.getElementById('btn-cancel-team');
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
  }

  closeTeamEdit() {
    document.getElementById('team-form').reset();
    document.getElementById('edit-team-id').value = '';
    this.clearFormErrors('team-form');

    document.getElementById('team-form-title').textContent = 'Cadastrar Nova Equipe';
    document.getElementById('btn-team-submit-text').textContent = 'Cadastrar Equipe';

    const cancelBtn = document.getElementById('btn-cancel-team');
    if (cancelBtn) cancelBtn.style.display = 'none';
  }

  handleTeamSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('edit-team-id').value;
    const nameEl = document.getElementById('team-name');
    const respEl = document.getElementById('team-responsible');

    let isValid = true;
    isValid = this.validateField(nameEl, nameEl.value.trim().length >= 3) && isValid;
    isValid = this.validateField(respEl, respEl.value.trim().length >= 3) && isValid;

    if (!isValid) {
      showToast('Por favor, preencha os campos obrigatórios corretamente (mínimo 3 caracteres).', 'error');
      return;
    }

    try {
      if (id) {
        // Edit mode
        store.updateTeam(id, {
          name: nameEl.value.trim(),
          responsible: respEl.value.trim()
        });
        showToast('Equipe atualizada com sucesso!', 'success');
      } else {
        // Add mode
        store.addTeam({
          name: nameEl.value.trim(),
          responsible: respEl.value.trim()
        });
        showToast('Nova equipe cadastrada com sucesso!', 'success');
      }

      this.closeTeamEdit();
      this.renderTeams();
      this.populateDeliveryDropdowns(); // Update selections elsewhere in the app
      this.populateCampoDropdowns();
    } catch (err) {
      showToast('Erro ao salvar equipe: ' + err.message, 'error');
    }
  }

  handleTeamDelete(id) {
    const team = store.getTeam(id);
    if (!team) return;

    if (confirm(`Deseja realmente excluir a equipe "${team.name}"?\nEsta ação pode afetar a seleção de equipes nas entregas.`)) {
      try {
        store.deleteTeam(id);
        showToast('Equipe removida com sucesso.', 'info');
        this.closeTeamEdit();
        this.renderTeams();
        this.populateDeliveryDropdowns();
        this.populateCampoDropdowns();
      } catch (err) {
        showToast('Erro ao excluir equipe: ' + err.message, 'error');
      }
    }
  }

  openAddExpenseModal(preselectedDeploymentId = null) {
    const modal = document.getElementById('expense-modal');
    const form = document.getElementById('expense-form');
    if (!modal || !form) return;

    // Reset Form
    form.reset();

    // Reset Error Classes
    form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    form.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));

    // Set Date default
    const dateEl = document.getElementById('expense-date');
    if (dateEl) {
      dateEl.value = new Date().toISOString().split('T')[0];
    }

    // Populate Deployments Dropdown
    const depSelect = document.getElementById('expense-deployment-id');
    if (depSelect) {
      const deployments = store.getDeployments();
      depSelect.innerHTML = '<option value="">Selecione uma obra...</option>' + deployments.map(d => `
        <option value="${d.id}">
          ${d.city ? `${d.city} (${d.name})` : d.name}
        </option>
      `).join('');

      // Auto-select if passed
      if (preselectedDeploymentId) {
        depSelect.value = preselectedDeploymentId;
      }
    }

    // Bind Close Button if not already bound
    const btnClose = document.getElementById('btn-close-expense-modal');
    const btnCancel = document.getElementById('btn-cancel-expense');

    const closeHandler = () => this.closeAddExpenseModal();
    if (btnClose && !btnClose.dataset.bound) {
      btnClose.addEventListener('click', closeHandler);
      btnClose.dataset.bound = 'true';
    }
    if (btnCancel && !btnCancel.dataset.bound) {
      btnCancel.addEventListener('click', closeHandler);
      btnCancel.dataset.bound = 'true';
    }

    modal.classList.add('active');
  }

  closeAddExpenseModal() {
    const modal = document.getElementById('expense-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  }

  handleExpenseSubmit(e) {
    e.preventDefault();

    const deploymentIdEl = document.getElementById('expense-deployment-id');
    const typeEl = document.getElementById('expense-type');
    const valueEl = document.getElementById('expense-value');
    const descEl = document.getElementById('expense-description');
    const dateEl = document.getElementById('expense-date');

    let isValid = true;
    isValid = this.validateField(deploymentIdEl, deploymentIdEl.value !== '') && isValid;
    isValid = this.validateField(typeEl, typeEl.value !== '') && isValid;
    
    const valVal = parseFloat(valueEl.value);
    isValid = this.validateField(valueEl, !isNaN(valVal) && valVal > 0) && isValid;

    if (!isValid) {
      showToast('Por favor, preencha os campos obrigatórios corretamente.', 'error');
      return;
    }

    try {
      store.addExpense({
        deploymentId: deploymentIdEl.value,
        type: typeEl.value,
        value: valVal,
        description: descEl.value.trim() || typeEl.value,
        date: dateEl ? dateEl.value : null
      });
      showToast('Despesa registrada com sucesso!', 'success');

      this.closeAddExpenseModal();
      
      // If we are in the cost center, re-render it
      if (this.activeSection === 'custos') {
        this.renderCostCenter();
      }
    } catch (err) {
      showToast('Erro ao registrar despesa: ' + err.message, 'error');
    }
  }

  handleExpenseDelete(id) {
    if (confirm('Deseja realmente excluir esta despesa extra?')) {
      try {
        store.deleteExpense(id);
        showToast('Despesa extra excluída com sucesso.', 'info');
        this.renderCostCenter();
      } catch (err) {
        showToast('Erro ao excluir despesa: ' + err.message, 'error');
      }
    }
  }

  // ==========================================
  // 4. RENDERERS
  // ==========================================

  // --- Render Dashboard ---
  renderDashboardMetrics() {
    // Pre-resolve selected deployment ID if not set
    const deployments = store.getDeployments();
    if (!this.selectedDashboardDeploymentId && deployments.length > 0) {
      let defaultDep = deployments.find(d => d.status === 'em_andamento');
      if (!defaultDep) {
        defaultDep = deployments.find(d => d.status === 'planejamento');
      }
      if (!defaultDep) {
        defaultDep = deployments[0];
      }
      if (defaultDep) {
        this.selectedDashboardDeploymentId = defaultDep.id;
      }
    }

    // Populate top deployment selector
    const topSelectEl = document.getElementById('top-deployment-select');
    if (topSelectEl) {
      if (deployments.length === 0) {
        topSelectEl.innerHTML = '<option value="">Sem lançamentos</option>';
      } else {
        topSelectEl.innerHTML = deployments.map(d => `
          <option value="${d.id}" ${d.id === this.selectedDashboardDeploymentId ? 'selected' : ''} style="background: var(--bg-secondary); color: var(--text-primary); font-weight: 600;">
            ${d.city ? `${d.city} (${d.name})` : d.name}
          </option>
        `).join('');
      }
    }

    const metrics = store.getMetrics(this.selectedDashboardDeploymentId);
    
    // Update metric card DOM elements safely to prevent crashes if IDs are missing or renamed in index.html
    const totalStockEl = document.getElementById('dash-total-stock');
    if (totalStockEl) {
      totalStockEl.textContent = metrics.totalMaterialsStock.toLocaleString('pt-BR');
    }
    
    const stockValueEl = document.getElementById('dash-stock-value');
    if (stockValueEl) {
      stockValueEl.textContent = `R$ ${metrics.totalStockValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total valorado`;
    }
    
    const totalFieldEl = document.getElementById('dash-total-field');
    if (totalFieldEl) {
      totalFieldEl.textContent = metrics.totalMaterialsField.toLocaleString('pt-BR');
    }
    
    const activeDeploymentsEl = document.getElementById('dash-active-deployments');
    if (activeDeploymentsEl) {
      activeDeploymentsEl.textContent = metrics.activeDeploymentsCount;
    }
    
    const totalCostEl = document.getElementById('dash-total-cost');
    if (totalCostEl) {
      totalCostEl.textContent = `R$ ${metrics.totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    // --- Custo até o momento (consumo real) ---
    this.renderLaunchCostCard();

    this.renderHighlightCard();
    this.renderDashboardMapCard();
    this.renderDashboardAlerts();
    this.renderDashboardCategoryChart();
  }

  renderLaunchCostCard() {
    const dep = this.selectedDashboardDeploymentId
      ? store.getDeployment(this.selectedDashboardDeploymentId)
      : null;

    const valueEl   = document.getElementById('dash-cost-real');
    const pctEl     = document.getElementById('dash-cost-pct');
    const plannedEl = document.getElementById('dash-cost-planned');
    const countEl   = document.getElementById('dash-cost-count');

    if (!valueEl) return;

    if (!dep) {
      valueEl.textContent   = 'R$ 0,00';
      if (pctEl)     pctEl.textContent     = '0%';
      if (plannedEl) plannedEl.textContent = 'R$ 0,00';
      if (countEl)   countEl.textContent   = '0 registros';
      return;
    }

    // Custo real = soma de consumos + pagamentos de mão de obra + despesas extras
    const consumptions = (store.state.consumptions || []).filter(c => c.deploymentId === dep.id);
    const labor = (store.state.laborPayments || []).filter(l => l.deploymentId === dep.id);
    const expenses = (store.state.expenses || []).filter(e => e.deploymentId === dep.id);
    
    const materialsCost = consumptions.reduce((sum, c) => {
      const mat = store.getMaterial(c.materialId);
      const price = mat ? mat.unitValue : (c.unitValue || 0);
      return sum + (c.quantity * price);
    }, 0);
    
    const laborCost = labor.reduce((sum, l) => sum + l.value, 0);
    const expensesCost = expenses.reduce((sum, e) => sum + e.value, 0);

    const inventoryTransactions = store.getInventoryTransactions() || [];
    const opConsumptions = inventoryTransactions.filter(t => t.type === 'consumo_obra' && t.deploymentId === dep.id);
    const opConsumptionsCost = opConsumptions.reduce((sum, t) => sum + (t.value || 0), 0);

    const realCost = materialsCost + laborCost + expensesCost + opConsumptionsCost;

    // Custo planejado total (materiais + mão de obra)
    const plannedCost = store.getDeploymentTotalCost(dep);

    // Percentual executado
    const pct = plannedCost > 0 ? Math.min(Math.round((realCost / plannedCost) * 100), 999) : 0;

    valueEl.textContent = `R$ ${realCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (pctEl) {
      pctEl.textContent = `${pct}%`;
      pctEl.style.color = pct >= 100 ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#3B82F6';
    }
    if (plannedEl) plannedEl.textContent = `R$ ${plannedCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const totalRecords = consumptions.length + opConsumptions.length;
    if (countEl) countEl.textContent = `${totalRecords} registro${totalRecords !== 1 ? 's' : ''}`;
  }

  // --- Render Highlight Active/In-Progress Deployment ---
  renderHighlightCard() {
    const cardEl = document.getElementById('dashboard-highlight-card');
    if (!cardEl) return;

    const deployments = store.getDeployments();
    
    // Resolve active or selected deployment
    let activeDep = null;
    if (this.selectedDashboardDeploymentId) {
      activeDep = deployments.find(d => d.id === this.selectedDashboardDeploymentId);
    }
    if (!activeDep) {
      activeDep = deployments.find(d => d.status === 'em_andamento');
    }
    if (!activeDep) {
      activeDep = deployments.find(d => d.status === 'planejamento');
    }
    if (!activeDep && deployments.length > 0) {
      activeDep = deployments[0];
    }

    if (activeDep) {
      this.selectedDashboardDeploymentId = activeDep.id;
    }

    if (!activeDep) {
      // Clean empty state when no deployments exist
      cardEl.innerHTML = `
        <div class="empty-state" style="padding: 40px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center;">
          <i data-lucide="help-circle" class="text-tertiary" style="width: 36px; height: 36px; stroke-width: 1.5; margin-bottom: 12px; color: var(--text-tertiary);"></i>
          <h3 style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Nenhum Lançamento Ativo</h3>
          <p style="font-size: 11px; color: var(--text-secondary); max-width: 200px;">Cadastre uma nova obra na aba Lançamentos para visualizar o rastreamento.</p>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    // Get all logistics entries for this active deployment
    const deliveries = store.getDeliveries().filter(d => d.deploymentId === activeDep.id);
    const returns = store.getReturns().filter(r => r.deploymentId === activeDep.id);

    // 1. Calculate fiber distance in km (delivered - returned)
    const deliveredCables = deliveries.reduce((acc, d) => {
      const mat = store.getMaterial(d.materialId);
      if (mat && (mat.category === 'cabos' || mat.unit === 'metro')) {
        return acc + d.quantity;
      }
      return acc;
    }, 0);

    const returnedCables = returns.reduce((acc, r) => {
      const mat = store.getMaterial(r.materialId);
      if (mat && (mat.category === 'cabos' || mat.unit === 'metro')) {
        return acc + r.quantity;
      }
      return acc;
    }, 0);

    // Use delivered minus returned. If no movements exist, fallback to planned cables.
    let cablesMeters = 0;
    if (deliveries.length > 0 || returns.length > 0) {
      cablesMeters = Math.max(0, deliveredCables - returnedCables);
    } else {
      cablesMeters = activeDep.plannedMaterials.reduce((acc, p) => {
        const mat = store.getMaterial(p.materialId);
        if (mat && (mat.category === 'cabos' || mat.unit === 'metro')) {
          return acc + p.quantity;
        }
        return acc;
      }, 0);
    }
    const distText = cablesMeters > 0 ? `${(cablesMeters / 1000).toFixed(2)} km` : '0.00 km';

    // 2. Calculate duration in days
    const start = new Date(activeDep.startDate);
    const end = new Date(activeDep.endDate);
    const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) || 0;
    const tempoText = `${diffDays} dias`;

    // 3. Calculate cost (Orçamento / Custo) (delivered - returned)
    let cost = 0;
    if (deliveries.length > 0 || returns.length > 0) {
      const deliveredCost = deliveries.reduce((acc, d) => {
        const mat = store.getMaterial(d.materialId);
        const price = mat ? mat.unitValue : d.unitValue || 0;
        return acc + (d.quantity * price);
      }, 0);

      const returnedCost = returns.reduce((acc, r) => {
        const mat = store.getMaterial(r.materialId);
        const price = mat ? mat.unitValue : r.unitValue || 0;
        return acc + (r.quantity * price);
      }, 0);

      cost = Math.max(0, deliveredCost - returnedCost);
    } else {
      cost = activeDep.plannedMaterials.reduce((acc, p) => {
        const mat = store.getMaterial(p.materialId);
        const price = mat ? mat.unitValue : p.unitValue || 0;
        return acc + (p.quantity * price);
      }, 0);
    }
    const costText = `R$ ${cost.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;

    // 4. Calculate progress percentage
    let progress = 0;
    if (activeDep.status === 'finalizado') {
      progress = 100;
    } else if (activeDep.status === 'planejamento') {
      progress = 0;
    } else {
      const today = new Date();
      if (today >= end) {
        progress = 90;
      } else if (today <= start) {
        progress = 5;
      } else {
        const total = end - start;
        const elapsed = today - start;
        progress = Math.min(90, Math.max(10, Math.round((elapsed / total) * 100)));
      }
    }

    // Status Badge classes
    let statusLabel = 'Em Andamento';
    if (activeDep.status === 'planejamento') {
      statusLabel = 'Planejamento';
    } else if (activeDep.status === 'finalizado') {
      statusLabel = 'Finalizado';
    }

    // Update new modern dashboard elements
    const setEl = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };
    
    setEl('dash-dep-name', activeDep.name);
    setEl('dash-dep-status', statusLabel);
    
    const badgeEl = document.getElementById('dash-dep-status');
    if (badgeEl) {
      badgeEl.className = 'dash-badge'; // reset
      if (activeDep.status === 'planejamento') {
        badgeEl.style.background = '#FEF3C7'; badgeEl.style.color = '#D97706';
      } else if (activeDep.status === 'finalizado') {
        badgeEl.style.background = '#E0E7FF'; badgeEl.style.color = '#4338CA';
      } else {
        badgeEl.style.background = '#D1FAE5'; badgeEl.style.color = '#059669'; // em andamento
      }
    }

    setEl('dash-dep-pct', `${progress}%`);
    setEl('dash-dep-est', `Conclusão estimada: ${diffDays} dias`);
    const barEl = document.getElementById('dash-dep-bar');
    if (barEl) barEl.style.width = `${progress}%`;

    setEl('dash-dep-distance', distText);
    setEl('dash-dep-duration', tempoText);
    setEl('dash-dep-budget', costText);

    setEl('dash-dep-resp', activeDep.responsible || 'Equipe Principal');
    setEl('dash-dep-city', activeDep.city ? `${activeDep.city} (${activeDep.name})` : activeDep.name);

    // Update Map Overlay mock values based on deployment
    setEl('dash-map-marker-name', activeDep.name);
    setEl('dash-overlay-route', activeDep.name);
    setEl('dash-overlay-city', activeDep.city || 'Local Padrão');
    setEl('dash-overlay-team', activeDep.responsible || 'Padrão');
    setEl('dash-overlay-status', statusLabel);
    if (window.lucide) lucide.createIcons();
  }

  renderDashboardMapCard() {
    const mapContainer = document.querySelector('.dash-map-bg');
    if (!mapContainer) return;

    const deployments = store.getDeployments();
    let activeDep = null;
    if (this.selectedDashboardDeploymentId) {
      activeDep = deployments.find(d => d.id === this.selectedDashboardDeploymentId);
    }
    if (!activeDep && deployments.length > 0) activeDep = deployments[0];

    const query = (activeDep && (activeDep.address || activeDep.city)) ? (activeDep.address || activeDep.city) : '';

    // Remove existing iframe if any
    const existingIframe = mapContainer.querySelector('.real-map-iframe');
    if (existingIframe) existingIframe.remove();

    if (activeDep && query) {
      const iframe = document.createElement('iframe');
      iframe.className = 'real-map-iframe';
      iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
      iframe.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; z-index: 0; filter: contrast(1.1) saturate(1.2); pointer-events: none; opacity: 0.6;';
      mapContainer.prepend(iframe);
    }

    if (window.lucide) lucide.createIcons();
  }

  renderDashboardAlerts() {
    const alertsList = document.getElementById('dashboard-alerts-list');
    const alertBadge = document.getElementById('alert-count-badge');
    if (!alertsList) return;

    const allAlerts = store.getLowStockAndConflicts();
    alertBadge.textContent = `${allAlerts.length} Alerta${allAlerts.length === 1 ? '' : 's'}`;
    
    if (allAlerts.length === 0) {
      alertsList.innerHTML = `
        <div class="empty-state">
          <i data-lucide="check-circle" class="icon-emerald"></i>
          <h3>Estoque Seguro!</h3>
          <p>Nenhum item com estoque crítico ou reservas em conflito.</p>
        </div>
      `;
      alertBadge.className = 'badge badge-green';
      lucide.createIcons();
      return;
    }

    // Set badge style to Red if there are critical conflicts or out-of-stock items
    const hasCritical = allAlerts.some(a => a.qty === 0 || a.type === 'conflict');
    alertBadge.className = hasCritical ? 'badge-red' : 'badge-amber';

    alertsList.innerHTML = allAlerts.map(alert => {
      if (alert.type === 'stock') {
        const isOutOfStock = alert.qty === 0;
        const badgeClass = isOutOfStock ? 'badge-red' : 'badge-amber';
        
        return `
          <div class="alert-item ${isOutOfStock ? 'critical-alert' : 'warning-alert'}">
            <div class="alert-item-left">
              <span class="alert-item-name">${alert.name}</span>
              <span class="alert-item-meta">
                Mínimo em estoque: ${alert.min} ${DEFAULT_UNITS[alert.unit].toLowerCase()} | 
                Categoria: ${DEFAULT_CATEGORIES[alert.category]}
              </span>
            </div>
            <div class="flex-align">
              <span class="badge ${badgeClass}">${alert.message}</span>
              <strong class="stat-value ${isOutOfStock ? 'text-danger' : 'text-warning'}">
                ${alert.qty.toLocaleString('pt-BR')} ${alert.unit === 'metro' ? 'm' : 'un'}
              </strong>
            </div>
          </div>
        `;
      } else {
        // Planning Conflict Alert
        return `
          <div class="alert-item critical-alert">
            <div class="alert-item-left">
              <span class="alert-item-name">⚠️ ${alert.name}</span>
              <span class="alert-item-meta">
                Estoque físico atual: <strong>${alert.qty}</strong> | 
                Total planejado em obras: <strong>${alert.planned}</strong> ${DEFAULT_UNITS[alert.unit].toLowerCase()}
              </span>
            </div>
            <div class="flex-align">
              <span class="badge badge-red">FALTA ESTOQUE</span>
              <strong class="stat-value text-danger">
                -${alert.deficit.toLocaleString('pt-BR')} ${alert.unit === 'metro' ? 'm' : 'un'}
              </strong>
            </div>
          </div>
        `;
      }
    }).join('');
    lucide.createIcons();
  }

  renderDashboardCategoryChart() {
    const container = document.getElementById('category-summary-list');
    if (!container) return;

    const materials = store.getMaterials();
    if (materials.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>Nenhum material no estoque.</p></div>`;
      return;
    }

    const catSums = {};
    let totalQty = 0;

    materials.forEach(m => {
      catSums[m.category] = (catSums[m.category] || 0) + m.quantity;
      totalQty += m.quantity;
    });

    if (totalQty === 0) {
      container.innerHTML = `<div class="empty-state"><p>Estoque atual zerado.</p></div>`;
      return;
    }

    let html = '';
    for (const [key, name] of Object.entries(DEFAULT_CATEGORIES)) {
      const qty = catSums[key] || 0;
      const percentage = (qty / totalQty) * 100;
      
      if (qty > 0) {
        html += `
          <div class="category-bar-item">
            <div class="category-bar-header">
              <span>${name}</span>
              <span class="text-secondary">${qty.toLocaleString('pt-BR')} (${percentage.toFixed(1)}%)</span>
            </div>
            <div class="category-bar-wrapper">
              <div class="category-bar-fill" style="width: ${percentage}%"></div>
            </div>
          </div>
        `;
      }
    }

    container.innerHTML = html || `<div class="empty-state"><p>Sem materiais com saldo ativo.</p></div>`;
  }

  // --- Render Stock (Estoque) ---
  renderStockList() {
    const tbody = document.getElementById('inventory-tbody');
    const emptyState = document.getElementById('inventory-empty-state');
    if (!tbody || !emptyState) return;

    const query = document.getElementById('inv-search')?.value.toLowerCase().trim() || '';
    const typeFilter = document.getElementById('inv-type-filter')?.value || 'todos';
    const catFilter = document.getElementById('inv-category-filter')?.value || 'todos';

    // Populate categories filter if empty
    const catSelect = document.getElementById('inv-category-filter');
    if (catSelect && catSelect.options.length <= 1) {
      catSelect.innerHTML = '<option value="todos">Todas Categorias</option>' + 
        Object.keys(DEFAULT_CATEGORIES).map(k => `<option value="${k}">${DEFAULT_CATEGORIES[k]}</option>`).join('');
    }

    let items = store.getMaterials() || [];

    // METRICS CALCS
    const physicalItems = items.filter(i => i.type !== 'consumo');
    const opItems = items.filter(i => i.type === 'consumo');

    const physicalVal = physicalItems.reduce((sum, i) => sum + ((i.quantity || 0) * (i.unitValue || 0)), 0);
    const opVal = opItems.reduce((sum, i) => sum + ((i.quantity || 0) * (i.unitValue || 0)), 0);
    const lowStockCount = physicalItems.filter(i => (i.quantity || 0) <= (i.minStock || 0)).length;

    // Calculate transit and consumed (physical)
    const deliveries = store.state.deliveries || [];
    const returns = store.state.returns || [];
    const consumptions = store.state.consumptions || [];
    
    const deliveredVal = deliveries.reduce((sum, d) => {
      const mat = store.getMaterial(d.materialId);
      return sum + (d.quantity * (mat ? mat.unitValue : d.unitValue || 0));
    }, 0);
    const returnedVal = returns.reduce((sum, r) => {
      const mat = store.getMaterial(r.materialId);
      return sum + (r.quantity * (mat ? mat.unitValue : r.unitValue || 0));
    }, 0);
    const consumedVal = consumptions.reduce((sum, c) => {
      const mat = store.getMaterial(c.materialId);
      return sum + (c.quantity * (mat ? mat.unitValue : c.unitValue || 0));
    }, 0);
    const transitVal = Math.max(0, deliveredVal - returnedVal - consumedVal);

    // Update Cards
    const elPhysical = document.getElementById('inv-card-physical-val');
    const elTransit = document.getElementById('inv-card-transit-val');
    const elConsumed = document.getElementById('inv-card-consumed-val');
    const elOp = document.getElementById('inv-card-op-val');
    const elCount = document.getElementById('inv-card-items-count');
    const elLow = document.getElementById('inv-card-low-stock');

    if (elPhysical) elPhysical.textContent = `R$ ${physicalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elTransit) elTransit.textContent = `R$ ${transitVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elConsumed) elConsumed.textContent = `R$ ${consumedVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elOp) elOp.textContent = `R$ ${opVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elCount) elCount.textContent = items.length;
    if (elLow) elLow.textContent = lowStockCount;

    // FILTERS
    if (query) items = items.filter(m => m.name.toLowerCase().includes(query));
    if (typeFilter !== 'todos') {
      items = items.filter(m => (typeFilter === 'consumo') ? m.type === 'consumo' : m.type !== 'consumo');
    }
    if (catFilter !== 'todos') items = items.filter(m => m.category === catFilter);

    if (items.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.parentElement.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    tbody.parentElement.style.display = 'table';

    tbody.innerHTML = items.map(item => {
      const isConsumo = item.type === 'consumo';
      const isBelowMin = !isConsumo && item.quantity <= item.minStock;
      const totalValue = (item.quantity || 0) * (item.unitValue || 0);
      
      let typeBadge = isConsumo 
        ? `<span class="badge" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">Consumo Op.</span>`
        : `<span class="badge" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">Material Físico</span>`;

      let qtyColor = isBelowMin ? 'color: #ef4444; font-weight: bold;' : '';
      let unitLabel = DEFAULT_UNITS[item.unit] ? DEFAULT_UNITS[item.unit].toLowerCase() : item.unit;

      return `
        <tr>
          <td>
            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${item.name}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">${DEFAULT_CATEGORIES[item.category] || item.category}</div>
          </td>
          <td>${typeBadge}</td>
          <td style="text-align: right; ${qtyColor}">
            ${(item.quantity || 0).toLocaleString('pt-BR')} ${unitLabel}
          </td>
          <td style="text-align: right;">R$ ${(item.unitValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align: right; font-weight: 600;">R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align: center;">
            <button class="btn-icon" title="Editar Item" onclick="appView.openMaterialEditModal('${item.id}')">
              <i data-lucide="pencil"></i>
            </button>
            <button class="btn-icon delete-btn" title="Excluir" onclick="appView.handleMaterialDelete('${item.id}')">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  // --- Render Deployments (Lançamentos Expandidos) ---
  renderDeploymentsList() {
    const grid = document.getElementById('deployments-grid');
    if (!grid) return;

    const query = document.getElementById('deployment-search').value.toLowerCase().trim();
    const statusFilter = document.getElementById('deployment-status-filter').value;

    let list = store.getDeployments();

    // Text search filter (matches neighborhood/city, city field or responsible lead)
    if (query) {
      list = list.filter(d => 
        d.name.toLowerCase().includes(query) || 
        (d.city && d.city.toLowerCase().includes(query)) ||
        d.responsible.toLowerCase().includes(query)
      );
    }
    
    // Status filter
    if (statusFilter !== 'todos') {
      list = list.filter(d => d.status === statusFilter);
    }

    if (list.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <i data-lucide="filter" class="icon-large"></i>
          <h3>Nenhum lançamento encontrado</h3>
          <p>Tente ajustar os termos de pesquisa ou crie um lançamento clicando em "Novo Lançamento".</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    // Sort by chronological reverse order
    list.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

    grid.innerHTML = list.map(d => {
      const hasConflict = store.checkDeploymentConflicts(d);
      
      // Status Badge styles
      let statusBadge = '';
      if (d.status === 'planejamento') {
        statusBadge = `<span class="badge badge-amber flex-align"><i data-lucide="calendar"></i> Planejamento</span>`;
      } else if (d.status === 'em_andamento') {
        statusBadge = `<span class="badge badge-blue flex-align"><i data-lucide="activity"></i> Em Andamento</span>`;
      } else {
        statusBadge = `<span class="badge badge-green flex-align"><i data-lucide="check-circle-2"></i> Finalizado</span>`;
      }

      const totalCost = store.getDeploymentTotalCost(d);
      const actualCost = store.getDeploymentActualCost(d);
      const plannedCount = d.plannedMaterials.length;

      // Formatting Dates
      const startFormatted = new Date(d.startDate + 'T00:00:00').toLocaleDateString('pt-BR');
      const endFormatted = new Date(d.endDate + 'T00:00:00').toLocaleDateString('pt-BR');

      return `
        <div class="deployment-card ${hasConflict ? 'has-conflict' : ''}">
          <div>
            <div class="deployment-card-header">
              <h3 class="deployment-title">${d.city ? `${d.city} - ` : ''}${d.name}</h3>
              ${statusBadge}
            </div>
            
            <div class="deployment-meta" style="margin-bottom: 12px;">Responsável: <strong>${d.responsible}</strong></div>
            
            ${hasConflict ? `
              <div class="deployment-conflict-badge">
                <i data-lucide="alert-octagon"></i>
                <span>Reserva supera o estoque!</span>
              </div>
            ` : ''}

            <div class="deployment-details">
              <div class="deployment-row">
                <span class="text-secondary">Cronograma:</span>
                <span class="stat-value text-right" style="font-size: 12px;">
                  ${startFormatted} até ${endFormatted}
                </span>
              </div>
              <div class="deployment-row">
                <span class="text-secondary">Itens Planejados:</span>
                <span class="stat-value">${plannedCount} material${plannedCount === 1 ? '' : 'is'}</span>
              </div>
              
              ${d.notes ? `
                <div class="deployment-row" style="border-top: 1px solid rgba(255,255,255,0.03); padding-top: 6px;">
                  <span class="text-secondary" style="font-size: 11px; font-style: italic; max-height: 36px; overflow:hidden;">
                    "${d.notes}"
                  </span>
                </div>
              ` : ''}

              <div class="deployment-row deployment-cost-row">
                <span>Custo Planejado:</span>
                <span class="deployment-cost-value text-secondary">
                  R$ ${totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div class="deployment-row deployment-cost-row" style="margin-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px;">
                <span>Custo Realizado:</span>
                <span class="deployment-cost-value" style="color: var(--primary-color); font-weight: 700;">
                  R$ ${actualCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
          
          <div class="deployment-footer-actions">
            <div class="deployment-action-left">
              <button class="btn btn-action-small btn-planning" onclick="appView.openPlanningModal('${d.id}')">
                <i data-lucide="settings-2"></i>
                <span>Planejar Materiais</span>
              </button>
            </div>
            <div class="deployment-action-right">
              <button class="btn-icon" title="Editar Detalhes" onclick="appView.openDeploymentEditModal('${d.id}')">
                <i data-lucide="pencil"></i>
              </button>
              <button class="btn-icon delete-btn" title="Excluir Lançamento" onclick="appView.handleDeploymentDelete('${d.id}')">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    lucide.createIcons();
  }

  // --- Render Nested Material Planning Table inside modal ---
  renderPlanningList(deploymentId) {
    const tbody = document.getElementById('planning-tbody');
    const totalEl = document.getElementById('planning-total-cost-value');
    if (!tbody) return;

    const dep = store.getDeployment(deploymentId);
    if (!dep) return;

    const plannedList = dep.plannedMaterials;
    const materialsCost = plannedList.reduce((s, i) => s + i.quantity * i.unitValue, 0);
    const laborCost = store.getLaborTotalCost(dep);
    const totalCost = materialsCost + laborCost;
    
    // Update dynamic cost boxes
    if (totalEl) totalEl.textContent = `R$ ${totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const matCostEl = document.getElementById('planning-cost-materials');
    const labCostEl = document.getElementById('planning-cost-labor');
    if (matCostEl) matCostEl.textContent = `R$ ${materialsCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (labCostEl) labCostEl.textContent = `R$ ${laborCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    if (plannedList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-secondary" style="padding: 32px;">
            Nenhum material planejado nesta obra ainda. Use o painel acima para planejar materiais!
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = plannedList.map(item => {
      const material = store.getMaterial(item.materialId);
      const name = material ? material.name : 'Material Removido';
      const unit = material ? DEFAULT_UNITS[material.unit].toLowerCase() : '';
      const stock = material ? material.quantity : 0;
      
      const itemTotalValue = item.quantity * item.unitValue;
      const isDeficit = item.quantity > stock;

      const statusBadge = isDeficit
        ? `<span class="badge badge-blue flex-align" style="font-size: 10px; display: inline-flex;"><i data-lucide="shopping-cart" style="width:12px; height:12px;"></i> A Adquirir</span>`
        : `<span class="badge badge-green flex-align" style="font-size: 10px; display: inline-flex;"><i data-lucide="check-circle" style="width:12px; height:12px;"></i> Em Estoque</span>`;

      return `
        <tr>
          <td style="font-weight:600;">${name}</td>
          <td><strong>${item.quantity.toLocaleString('pt-BR')}</strong> ${unit}</td>
          <td>${stock.toLocaleString('pt-BR')} ${unit}</td>
          <td>R$ ${item.unitValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td style="font-weight:700; color:var(--color-success);">R$ ${itemTotalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td>${statusBadge}</td>
          <td style="text-align: right;">
            <div class="flex-align" style="justify-content: flex-end; gap: 4px;">
              <button type="button" class="btn-icon" title="Editar quantidade planejada" onclick="appView.openPlanningEdit('${item.id}', '${item.materialId}', ${item.quantity})">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-icon delete-btn" title="Remover planejamento" onclick="appView.handlePlanningDelete('${item.id}')">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  renderLaborList(deploymentId) {
    const tbody = document.getElementById('labor-tbody');
    if (!tbody) return;

    const dep = store.getDeployment(deploymentId);
    if (!dep) return;

    const laborList = dep.laborItems || [];

    if (laborList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-secondary" style="padding: 32px;">
            Nenhuma mão de obra planejada. Use o formulário acima para adicionar serviços.
          </td>
        </tr>
      `;
      this.renderPlanningList(deploymentId); // update footer costs
      return;
    }

    tbody.innerHTML = laborList.map(item => {
      const total = item.quantity * item.unitValue;
      return `
        <tr>
          <td style="font-weight:600;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:28px;height:28px;border-radius:50%;background:rgba(0, 71, 204,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i data-lucide="hard-hat" style="width:13px;height:13px;color:var(--color-primary);"></i>
              </div>
              ${item.description}
            </div>
          </td>
          <td><span class="badge badge-purple" style="font-size:11px;text-transform:capitalize;">${item.unit}</span></td>
          <td><strong>${item.quantity.toLocaleString('pt-BR')}</strong></td>
          <td>R$ ${item.unitValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td style="font-weight:700;color:var(--color-primary);">R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td style="text-align:right;">
            <div class="flex-align" style="justify-content:flex-end;gap:4px;">
              <button type="button" class="btn-icon" title="Editar" onclick="appView.openLaborEdit('${item.id}')">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-icon delete-btn" title="Remover" onclick="appView.handleLaborDelete('${item.id}')">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    this.renderPlanningList(deploymentId); // update footer costs
    lucide.createIcons();
  }

  // ==========================================
  // 5. MODAL MANAGEMENT
  // ==========================================

  // --- Material Modal ---
  openMaterialModal() {
    document.getElementById('material-modal-title').textContent = 'Novo Material';
    document.getElementById('edit-material-id').value = '';
    document.getElementById('material-form').reset();
    this.clearFormErrors('material-form');
    document.getElementById('material-modal').classList.add('active');
  }

  openMaterialEditModal(id) {
    const material = store.getMaterial(id);
    if (!material) return;

    this.clearFormErrors('material-form');

    document.getElementById('material-modal-title').textContent = 'Editar Material';
    document.getElementById('edit-material-id').value = material.id;
    document.getElementById('material-name').value = material.name;
    document.getElementById('material-category').value = material.category;
    document.getElementById('material-unit').value = material.unit;
    document.getElementById('material-qty').value = material.quantity;
    document.getElementById('material-price').value = material.unitValue;
    document.getElementById('material-min').value = material.minStock;

    document.getElementById('material-modal').classList.add('active');
  }

  closeMaterialModal() {
    document.getElementById('material-modal').classList.remove('active');
  }

  // --- Deployment Modal ---
  populateDeploymentResponsibleSelect(selectedValue = '') {
    const select = document.getElementById('deployment-responsible');
    if (!select) return;
    const teams = store.getTeams();
    let optionsHtml = '<option value="">Selecione a equipe...</option>';
    optionsHtml += teams.map(t => `<option value="${t.name}">${t.name} (Líder: ${t.responsible})</option>`).join('');
    
    if (selectedValue && !teams.some(t => t.name === selectedValue)) {
      optionsHtml += `<option value="${selectedValue}">${selectedValue}</option>`;
    }
    
    select.innerHTML = optionsHtml;
  }

  openDeploymentModal() {
    this.populateDeploymentResponsibleSelect();
    document.getElementById('deployment-modal-title').textContent = 'Novo Lançamento';
    document.getElementById('edit-deployment-id').value = '';
    document.getElementById('deployment-form').reset();
    this.clearFormErrors('deployment-form');
    document.getElementById('deployment-modal').classList.add('active');
  }

  openDeploymentEditModal(id) {
    const dep = store.getDeployment(id);
    if (!dep) return;

    this.clearFormErrors('deployment-form');

    this.populateDeploymentResponsibleSelect(dep.responsible);

    document.getElementById('deployment-modal-title').textContent = 'Editar Lançamento';
    document.getElementById('edit-deployment-id').value = dep.id;
    document.getElementById('deployment-name').value = dep.name;
    document.getElementById('deployment-city').value = dep.city || '';
    document.getElementById('deployment-address').value = dep.address || '';
    document.getElementById('deployment-status').value = dep.status;
    document.getElementById('deployment-responsible').value = dep.responsible;
    document.getElementById('deployment-start-date').value = dep.startDate;
    document.getElementById('deployment-end-date').value = dep.endDate;
    document.getElementById('deployment-notes').value = dep.notes;

    document.getElementById('deployment-modal').classList.add('active');
  }

  closeDeploymentModal() {
    document.getElementById('deployment-modal').classList.remove('active');
  }

  // --- Material Planning Modal [NEW] ---
  openPlanningModal(deploymentId) {
    const dep = store.getDeployment(deploymentId);
    if (!dep) return;

    const select = document.getElementById('planning-material-id');
    const form = document.getElementById('planning-form');
    if (!select || !form) return;

    // Reset planning form
    form.reset();
    this.clearFormErrors('planning-form');
    document.getElementById('planning-deployment-id').value = deploymentId;
    document.getElementById('edit-planned-item-id').value = '';
    document.getElementById('btn-save-planning-text').textContent = 'Adicionar';
    document.getElementById('planning-helper-text').style.display = 'none';
    document.getElementById('planning-alert-stock').style.display = 'none';
    
    // Set dynamic titles
    document.getElementById('planning-modal-title').textContent = `Planejamento de Materiais: ${dep.name}`;
    document.getElementById('planning-modal-subtitle').textContent = `Responsável: ${dep.responsible} | Status: ${STATUS_LABELS[dep.status]}`;

    // Populate dropdown with all stock items
    const materials = store.getMaterials();
    const optionsHtml = materials.map(m => {
      return `<option value="${m.id}">${m.name} (Saldo: ${m.quantity} ${DEFAULT_UNITS[m.unit].toLowerCase()})</option>`;
    });

    select.innerHTML = '<option value="">Selecionar material do estoque...</option>' + optionsHtml.join('');
    select.disabled = false; // Enabled for new additions

    this.renderPlanningList(deploymentId);
    this.renderLaborList(deploymentId);

    // Reset labor form
    const laborForm = document.getElementById('labor-form');
    if (laborForm) laborForm.reset();
    const editLaborId = document.getElementById('edit-labor-item-id');
    if (editLaborId) editLaborId.value = '';
    const btnLaborText = document.getElementById('btn-save-labor-text');
    if (btnLaborText) btnLaborText.textContent = 'Adicionar';

    // Always start on material tab
    this.switchPlanningTab('material');

    document.getElementById('planning-modal').classList.add('active');
  }

  closePlanningModal() {
    document.getElementById('planning-modal').classList.remove('active');
    this.renderAll(); // Always redraw parent grid when closing planning modal to refresh totals
  }

  switchPlanningTab(tab) {
    const materialPanel = document.getElementById('planning-panel-material');
    const laborPanel = document.getElementById('planning-panel-labor');
    const tabMaterial = document.getElementById('tab-material');
    const tabLabor = document.getElementById('tab-labor');

    if (tab === 'material') {
      if (materialPanel) materialPanel.style.display = 'block';
      if (laborPanel) laborPanel.style.display = 'none';
      if (tabMaterial) {
        tabMaterial.style.borderBottomColor = 'var(--color-primary)';
        tabMaterial.style.color = 'var(--color-primary)';
        tabMaterial.style.fontWeight = '700';
      }
      if (tabLabor) {
        tabLabor.style.borderBottomColor = 'transparent';
        tabLabor.style.color = 'var(--text-secondary)';
        tabLabor.style.fontWeight = '600';
      }
    } else {
      if (materialPanel) materialPanel.style.display = 'none';
      if (laborPanel) laborPanel.style.display = 'block';
      if (tabLabor) {
        tabLabor.style.borderBottomColor = 'var(--color-primary)';
        tabLabor.style.color = 'var(--color-primary)';
        tabLabor.style.fontWeight = '700';
      }
      if (tabMaterial) {
        tabMaterial.style.borderBottomColor = 'transparent';
        tabMaterial.style.color = 'var(--text-secondary)';
        tabMaterial.style.fontWeight = '600';
      }
    }
  }

  updatePlanningFormHelper(materialId) {
    const helper = document.getElementById('planning-helper-text');
    if (!helper) return;

    if (!materialId) {
      helper.style.display = 'none';
      return;
    }

    const material = store.getMaterial(materialId);
    if (material) {
      helper.innerHTML = `Estoque Físico: <strong>${material.quantity} ${DEFAULT_UNITS[material.unit].toLowerCase()}</strong> | Preço: <strong>R$ ${material.unitValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>`;
      helper.style.display = 'block';
    } else {
      helper.style.display = 'none';
    }
  }

  // Real-time deficit checker while planning
  checkLivePlanningConflict() {
    const alertBox = document.getElementById('planning-alert-stock');
    if (alertBox) {
      alertBox.style.display = 'none';
    }
  }

  // Trigger editing a planned row inside the planning table
  openPlanningEdit(itemId, materialId, quantity) {
    const select = document.getElementById('planning-material-id');
    const qtyInput = document.getElementById('planning-qty');
    const editId = document.getElementById('edit-planned-item-id');
    const btnText = document.getElementById('btn-save-planning-text');

    if (!select || !qtyInput || !editId || !btnText) return;

    this.clearFormErrors('planning-form');

    // Populate values
    select.value = materialId;
    select.disabled = true; // Cannot modify material ID while editing (delete and readd instead)
    qtyInput.value = quantity;
    editId.value = itemId;
    btnText.textContent = 'Atualizar';

    this.updatePlanningFormHelper(materialId);
    this.checkLivePlanningConflict();
    
    qtyInput.focus();
  }

  // ==========================================
  // 6. ACTION & FORM EVENT SUBMISSIONS
  // ==========================================

  // --- Form Validation Helpers ---
  validateField(inputEl, condition) {
    const formGroup = inputEl.closest('.form-group');
    if (condition) {
      formGroup.classList.remove('invalid');
      return true;
    } else {
      formGroup.classList.add('invalid');
      return false;
    }
  }

  clearFormErrors(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    
    form.querySelectorAll('.form-group').forEach(grp => {
      grp.classList.remove('invalid');
    });
  }

  // --- Services CRUD Handlers ---
  openServiceModal(id = null) {
    this.clearFormErrors('service-form');
    document.getElementById('service-form').reset();
    document.getElementById('service-id').value = '';

    if (id) {
      const srv = store.getServices().find(s => s.id === id);
      if (srv) {
        document.getElementById('service-modal-title').textContent = 'Editar Serviço';
        document.getElementById('service-id').value = srv.id;
        document.getElementById('service-name').value = srv.name;
        document.getElementById('service-unit').value = srv.unit;
        document.getElementById('service-value').value = srv.unitValue;
        document.getElementById('service-desc').value = srv.description || '';
      }
    } else {
      document.getElementById('service-modal-title').textContent = 'Novo Serviço';
    }

    const modal = document.getElementById('service-modal');
    if (modal) modal.classList.add('active');
  }

  closeServiceModal() {
    const modal = document.getElementById('service-modal');
    if (modal) modal.classList.remove('active');
  }

  handleServiceSubmit(e) {
    e.preventDefault();
    const idEl = document.getElementById('service-id');
    const nameEl = document.getElementById('service-name');
    const unitEl = document.getElementById('service-unit');
    const valEl = document.getElementById('service-value');
    const descEl = document.getElementById('service-desc');

    const valNum = parseFloat(valEl.value);

    let isValid = true;
    isValid = this.validateField(nameEl, nameEl.value.trim().length >= 3) && isValid;
    isValid = this.validateField(unitEl, unitEl.value !== '') && isValid;
    isValid = this.validateField(valEl, !isNaN(valNum) && valNum >= 0) && isValid;

    if (!isValid) return;

    const data = {
      name: nameEl.value.trim(),
      unit: unitEl.value,
      unitValue: valNum,
      description: descEl.value.trim()
    };

    try {
      if (idEl.value) {
        store.updateService(idEl.value, data);
        showToast('Serviço atualizado com sucesso.', 'success');
      } else {
        store.addService(data);
        showToast('Serviço cadastrado com sucesso.', 'success');
      }
      this.closeServiceModal();
      this.renderServicesList();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  deleteServiceItem(id) {
    if (confirm('Tem certeza que deseja excluir este serviço?')) {
      store.deleteService(id);
      showToast('Serviço excluído.', 'info');
      this.renderServicesList();
    }
  }

  editServiceItem(id) {
    this.openServiceModal(id);
  }

  renderServicesList() {
    const grid = document.getElementById('services-grid');
    if (!grid) return;

    const services = store.getServices();

    if (services.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <i data-lucide="briefcase" class="icon-large text-purple"></i>
          <h3>Nenhum serviço cadastrado</h3>
          <p>Clique em "Novo Serviço" para cadastrar serviços e tabelas de preços de mão de obra.</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    grid.innerHTML = services.map(s => `
      <div class="card item-card">
        <div class="item-card-header">
          <div class="item-icon-box bg-purple-light">
            <i data-lucide="briefcase" class="text-purple"></i>
          </div>
          <div class="item-actions">
            <button class="btn-icon" onclick="appView.editServiceItem('${s.id}')" title="Editar">
              <i data-lucide="edit-2"></i>
            </button>
            <button class="btn-icon text-red" onclick="appView.deleteServiceItem('${s.id}')" title="Excluir">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
        <div class="item-card-body">
          <h3 class="item-title">${s.name}</h3>
          <p class="item-category" style="margin-bottom:8px;">Unidade: <strong>${s.unit}</strong></p>
          <div style="font-size:16px; font-weight:700; color:var(--text-primary);">
            R$ ${s.unitValue.toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 })}
          </div>
          ${s.description ? `<p style="font-size:12px; color:var(--text-secondary); margin-top:8px;">${s.description}</p>` : ''}
        </div>
      </div>
    `).join('');
    
    lucide.createIcons();
  }

  // --- Material CRUD Handler ---
  handleMaterialSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('edit-material-id').value;
    const typeEl = document.getElementById('material-type');
    const nameEl = document.getElementById('material-name');
    const categoryEl = document.getElementById('material-category');
    const unitEl = document.getElementById('material-unit');
    const qtyEl = document.getElementById('material-qty');
    const priceEl = document.getElementById('material-price');
    const minEl = document.getElementById('material-min');

    // Validations
    let isValid = true;
    
    isValid = this.validateField(nameEl, nameEl.value.trim().length >= 3) && isValid;
    isValid = this.validateField(categoryEl, categoryEl.value !== '') && isValid;
    isValid = this.validateField(unitEl, unitEl.value !== '') && isValid;
    
    const qtyVal = parseFloat(qtyEl.value);
    isValid = this.validateField(qtyEl, !isNaN(qtyVal) && qtyVal >= 0) && isValid;

    const priceVal = parseFloat(priceEl.value);
    isValid = this.validateField(priceEl, !isNaN(priceVal) && priceVal >= 0) && isValid; // changed from >0 to >=0

    const minVal = parseFloat(minEl.value);
    isValid = this.validateField(minEl, !isNaN(minVal) && minVal >= 0) && isValid;

    if (!isValid) {
      showToast('Por favor, corrija os erros no formulário do item.', 'error');
      return;
    }

    const materialData = {
      type: typeEl ? typeEl.value : 'material',
      name: nameEl.value.trim(),
      category: categoryEl.value,
      unit: unitEl.value,
      quantity: qtyVal,
      unitValue: priceVal,
      minStock: minVal
    };

    try {
      if (id) {
        store.updateMaterial(id, materialData);
        showToast('Item atualizado com sucesso!', 'success');
      } else {
        store.addMaterial(materialData);
        showToast('Item adicionado com sucesso!', 'success');
      }

      this.closeMaterialModal();
      this.renderAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- Inventory Transactions Logic ---
  openInventoryTransactionModal() {
    const modal = document.getElementById('inventory-transaction-modal');
    const form = document.getElementById('transaction-form');
    if (!modal || !form) return;

    form.reset();
    form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    form.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));

    const dateEl = document.getElementById('txn-date');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];

    const itemSelect = document.getElementById('txn-item');
    if (itemSelect) {
      const items = store.getMaterials();
      itemSelect.innerHTML = '<option value="">Selecione o item...</option>' + items.map(i => `
        <option value="${i.id}">${i.name} (Saldo: ${i.quantity})</option>
      `).join('');
    }

    const depSelect = document.getElementById('txn-deployment');
    if (depSelect) {
      const deps = store.getDeployments();
      depSelect.innerHTML = '<option value="">Selecione a obra...</option>' + deps.map(d => `
        <option value="${d.id}">${d.city ? `${d.city} (${d.name})` : d.name}</option>
      `).join('');
    }

    const typeSelect = document.getElementById('txn-type');
    const wrapperDep = document.getElementById('txn-deployment-wrapper');
    if (typeSelect && wrapperDep) {
      const updateDepVisibility = () => {
        wrapperDep.style.display = typeSelect.value === 'consumo_obra' ? 'block' : 'none';
        if (typeSelect.value === 'consumo_obra') {
          depSelect.setAttribute('required', 'true');
        } else {
          depSelect.removeAttribute('required');
        }
      };
      if (!typeSelect.dataset.bound) {
        typeSelect.addEventListener('change', updateDepVisibility);
        typeSelect.dataset.bound = 'true';
      }
      updateDepVisibility();
    }

    modal.classList.add('active');
  }

  closeInventoryTransactionModal() {
    const modal = document.getElementById('inventory-transaction-modal');
    if (modal) modal.classList.remove('active');
  }

  handleTransactionSubmit(e) {
    e.preventDefault();

    const typeEl = document.getElementById('txn-type');
    const dateEl = document.getElementById('txn-date');
    const itemEl = document.getElementById('txn-item');
    const qtyEl = document.getElementById('txn-qty');
    const valEl = document.getElementById('txn-value');
    const depEl = document.getElementById('txn-deployment');
    const respEl = document.getElementById('txn-responsible');
    const obsEl = document.getElementById('txn-obs');

    let isValid = true;
    isValid = this.validateField(typeEl, typeEl.value !== '') && isValid;
    isValid = this.validateField(dateEl, dateEl.value !== '') && isValid;
    isValid = this.validateField(itemEl, itemEl.value !== '') && isValid;
    
    const qtyVal = parseFloat(qtyEl.value);
    isValid = this.validateField(qtyEl, !isNaN(qtyVal) && qtyVal > 0) && isValid;

    if (typeEl.value === 'consumo_obra') {
      isValid = this.validateField(depEl, depEl.value !== '') && isValid;
    }

    if (!isValid) {
      showToast('Preencha os campos obrigatórios corretamente.', 'error');
      return;
    }

    const item = store.getMaterial(itemEl.value);
    const valueNum = parseFloat(valEl.value);
    const finalValue = !isNaN(valueNum) && valueNum > 0 ? valueNum : (item ? item.unitValue * qtyVal : 0);

    try {
      store.addInventoryTransaction({
        type: typeEl.value,
        date: dateEl.value,
        itemId: itemEl.value,
        quantity: qtyVal,
        value: finalValue,
        deploymentId: typeEl.value === 'consumo_obra' ? depEl.value : null,
        responsible: respEl.value.trim(),
        observation: obsEl.value.trim()
      });

      showToast('Movimentação registrada com sucesso!', 'success');
      this.closeInventoryTransactionModal();
      this.renderAll();
    } catch (err) {
      showToast('Erro ao registrar: ' + err.message, 'error');
    }
  }

  handleMaterialDelete(id) {
    const material = store.getMaterial(id);
    if (!material) return;

    if (confirm(`Tem certeza de que deseja excluir o material "${material.name}" do estoque definitivo?`)) {
      try {
        store.deleteMaterial(id);
        showToast('Material excluído com sucesso do estoque.', 'success');
        this.renderAll();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }

  // --- Deployments CRUD Handlers ---
  handleDeploymentSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('edit-deployment-id').value;
    const nameEl = document.getElementById('deployment-name');
    const cityEl = document.getElementById('deployment-city');
    const addressEl = document.getElementById('deployment-address');
    const statusEl = document.getElementById('deployment-status');
    const startEl = document.getElementById('deployment-start-date');
    const endEl = document.getElementById('deployment-end-date');
    const responsibleEl = document.getElementById('deployment-responsible');
    const notesEl = document.getElementById('deployment-notes');

    // Validações
    let isValid = true;

    isValid = this.validateField(nameEl, nameEl.value.trim().length >= 3) && isValid;
    isValid = this.validateField(cityEl, cityEl.value.trim().length >= 2) && isValid;
    isValid = this.validateField(statusEl, statusEl.value !== '') && isValid;
    isValid = this.validateField(responsibleEl, responsibleEl.value !== '') && isValid;
    
    // Check start and end dates
    const startDateVal = startEl.value;
    const endDateVal = endEl.value;
    
    isValid = this.validateField(startEl, startDateVal !== '') && isValid;
    isValid = this.validateField(endEl, endDateVal !== '') && isValid;

    if (startDateVal && endDateVal) {
      const datesValid = new Date(startDateVal) <= new Date(endDateVal);
      isValid = this.validateField(endEl, datesValid) && isValid;
      if (!datesValid) {
        showToast('A data prevista de conclusão não pode ser anterior à data de início!', 'error');
      }
    }

    if (!isValid) {
      showToast('Por favor, verifique se os campos de cadastro de lançamento estão corretos.', 'error');
      return;
    }

    const deploymentData = {
      name: nameEl.value.trim(),
      city: cityEl.value.trim(),
      address: addressEl.value.trim(),
      status: statusEl.value,
      startDate: startDateVal,
      endDate: endDateVal,
      responsible: responsibleEl.value.trim(),
      notes: notesEl.value.trim()
    };

    try {
      if (id) {
        store.updateDeployment(id, deploymentData);
        showToast('Lançamento atualizado com sucesso!', 'success');
      } else {
        store.addDeployment(deploymentData);
        showToast('Lançamento cadastrado com sucesso!', 'success');
      }

      this.closeDeploymentModal();
      this.renderAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  handleDeploymentDelete(id) {
    const dep = store.getDeployment(id);
    if (!dep) return;

    if (confirm(`Tem certaza de que deseja excluir o lançamento "${dep.name}"? Isso também removerá todo o seu planejamento de materiais associado.`)) {
      store.deleteDeployment(id);
      showToast('Lançamento e planejamento excluídos do painel.', 'success');
      this.renderAll();
    }
  }

  // --- Nested Material Planning Form Submission [NEW] ---
  handlePlanningSubmit(e) {
    e.preventDefault();

    const deploymentId = document.getElementById('planning-deployment-id').value;
    const editItemId = document.getElementById('edit-planned-item-id').value;
    const materialIdEl = document.getElementById('planning-material-id');
    const qtyEl = document.getElementById('planning-qty');

    if (!deploymentId) return;

    let isValid = true;
    isValid = this.validateField(materialIdEl, materialIdEl.value !== '') && isValid;

    const qtyVal = parseFloat(qtyEl.value);
    isValid = this.validateField(qtyEl, !isNaN(qtyVal) && qtyVal > 0) && isValid;

    if (!isValid) {
      showToast('Digite uma quantidade planejada válida maior que zero.', 'error');
      return;
    }

    try {
      if (editItemId) {
        // Edit quantity in planning
        store.updatePlannedMaterial(deploymentId, editItemId, qtyVal);
        showToast('Quantidade planejada atualizada!', 'success');
      } else {
        // Add new planned material
        store.addPlannedMaterial(deploymentId, {
          materialId: materialIdEl.value,
          quantity: qtyVal
        });
        showToast('Material adicionado ao planejamento da obra!', 'success');
      }

      // Reset planning fields (leave material selection enabled and clear)
      document.getElementById('edit-planned-item-id').value = '';
      qtyEl.value = '';
      materialIdEl.disabled = false;
      document.getElementById('btn-save-planning-text').textContent = 'Adicionar';
      document.getElementById('planning-alert-stock').style.display = 'none';
      
      this.updatePlanningFormHelper(materialIdEl.value);
      this.renderPlanningList(deploymentId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  handlePlanningDelete(plannedItemId) {
    const deploymentId = document.getElementById('planning-deployment-id').value;
    if (!deploymentId) return;

    if (confirm('Deseja realmente remover este material do planejamento deste lançamento?')) {
      try {
        store.deletePlannedMaterial(deploymentId, plannedItemId);
        showToast('Material removido do planejamento.', 'info');
        
        // If we were editing this item, reset the form state
        const editId = document.getElementById('edit-planned-item-id').value;
        if (editId === plannedItemId) {
          document.getElementById('planning-form').reset();
          document.getElementById('planning-material-id').disabled = false;
          document.getElementById('edit-planned-item-id').value = '';
          document.getElementById('btn-save-planning-text').textContent = 'Adicionar';
          document.getElementById('planning-helper-text').style.display = 'none';
          document.getElementById('planning-alert-stock').style.display = 'none';
        }

        this.renderPlanningList(deploymentId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }

  handleLaborSubmit(e) {
    e.preventDefault();

    const deploymentId = document.getElementById('planning-deployment-id').value;
    if (!deploymentId) return;

    const editItemId = document.getElementById('edit-labor-item-id').value;
    const descEl = document.getElementById('labor-description');
    const unitEl = document.getElementById('labor-unit');
    const qtyEl = document.getElementById('labor-qty');
    const valEl = document.getElementById('labor-unit-value');

    let isValid = true;
    isValid = this.validateField(descEl, descEl.value.trim().length >= 3) && isValid;
    isValid = this.validateField(unitEl, unitEl.value !== '') && isValid;
    const qtyVal = parseFloat(qtyEl.value);
    isValid = this.validateField(qtyEl, !isNaN(qtyVal) && qtyVal > 0) && isValid;
    const unitVal = parseFloat(valEl.value);
    isValid = this.validateField(valEl, !isNaN(unitVal) && unitVal > 0) && isValid;

    if (!isValid) {
      showToast('Preencha todos os campos de mão de obra corretamente.', 'error');
      return;
    }

    const laborData = {
      description: descEl.value.trim(),
      unit: unitEl.value,
      quantity: qtyVal,
      unitValue: unitVal
    };

    try {
      if (editItemId) {
        store.updateLaborItem(deploymentId, editItemId, laborData);
        showToast('Mão de obra atualizada!', 'success');
      } else {
        store.addLaborItem(deploymentId, laborData);
        showToast('Mão de obra adicionada ao planejamento!', 'success');
      }

      document.getElementById('labor-form').reset();
      document.getElementById('edit-labor-item-id').value = '';
      document.getElementById('btn-save-labor-text').textContent = 'Adicionar';
      this.renderLaborList(deploymentId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  openLaborEdit(itemId) {
    const deploymentId = document.getElementById('planning-deployment-id').value;
    if (!deploymentId) return;

    const dep = store.getDeployment(deploymentId);
    if (!dep || !dep.laborItems) return;

    const item = dep.laborItems.find(l => l.id === itemId);
    if (!item) return;

    document.getElementById('edit-labor-item-id').value = item.id;
    document.getElementById('labor-description').value = item.description;
    document.getElementById('labor-unit').value = item.unit;
    document.getElementById('labor-qty').value = item.quantity;
    document.getElementById('labor-unit-value').value = item.unitValue;
    document.getElementById('btn-save-labor-text').textContent = 'Atualizar';
    document.getElementById('labor-description').focus();
  }

  handleLaborDelete(itemId) {
    const deploymentId = document.getElementById('planning-deployment-id').value;
    if (!deploymentId) return;

    if (confirm('Deseja remover este item de mão de obra do planejamento?')) {
      try {
        store.deleteLaborItem(deploymentId, itemId);
        showToast('Item de mão de obra removido.', 'info');

        const editId = document.getElementById('edit-labor-item-id').value;
        if (editId === itemId) {
          document.getElementById('labor-form').reset();
          document.getElementById('edit-labor-item-id').value = '';
          document.getElementById('btn-save-labor-text').textContent = 'Adicionar';
        }

        this.renderLaborList(deploymentId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }

  // ==========================================================================
  // PHASE 3 - LOGISTICS, FIELD OPERATIONS, AND REPORTS RENDERERS & HANDLERS
  // ==========================================================================

  // --- Dropdown Populadores ---
  populateDeliveryDropdowns() {
    const depSelect = document.getElementById('delivery-deployment-id');
    const matSelect = document.getElementById('delivery-material-id');
    if (!depSelect || !matSelect) return;

    const prevDep = depSelect.value;
    const prevMat = matSelect.value;

    const deployments = store.getDeployments();
    depSelect.innerHTML = '<option value="">Selecione a obra...</option>' + 
      deployments.map(d => `<option value="${d.id}">${d.name} (${STATUS_LABELS[d.status]})</option>`).join('');

    const materials = store.getMaterials();
    matSelect.innerHTML = '<option value="">Selecione o material...</option>' + 
      materials.map(m => `<option value="${m.id}">${m.name} (Saldo: ${m.quantity} ${DEFAULT_UNITS[m.unit].toLowerCase()})</option>`).join('');

    if (deployments.some(d => d.id === prevDep)) depSelect.value = prevDep;
    if (materials.some(m => m.id === prevMat)) {
      matSelect.value = prevMat;
      this.updateDeliveryFormHelper(prevMat);
    } else {
      document.getElementById('delivery-stock-helper').style.display = 'none';
    }

    // Populate team select dropdowns
    const teamSelect = document.getElementById('delivery-team');
    const editTeamSelect = document.getElementById('edit-delivery-team');
    const teams = store.getTeams();
    const teamOptions = '<option value="">Selecione a equipe...</option>' +
      teams.map(t => `<option value="${t.name}">${t.name} (Líder: ${t.responsible})</option>`).join('');

    if (teamSelect) {
      const prevTeam = teamSelect.value;
      teamSelect.innerHTML = teamOptions;
      if (teams.some(t => t.name === prevTeam)) teamSelect.value = prevTeam;
    }

    if (editTeamSelect) {
      const prevEditTeam = editTeamSelect.value;
      editTeamSelect.innerHTML = teamOptions;
      if (teams.some(t => t.name === prevEditTeam)) editTeamSelect.value = prevEditTeam;
    }
  }

  updateDeliveryFormHelper(materialId) {
    const helper = document.getElementById('delivery-stock-helper');
    if (!helper) return;

    if (!materialId) {
      helper.style.display = 'none';
      return;
    }

    const material = store.getMaterial(materialId);
    if (material) {
      helper.innerHTML = `Estoque Almoxarifado: <strong>${material.quantity} ${DEFAULT_UNITS[material.unit].toLowerCase()}</strong> | Preço: <strong>R$ ${material.unitValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>`;
      helper.style.display = 'block';
    } else {
      helper.style.display = 'none';
    }
  }

  populateCampoDropdowns() {
    const consumeDepSelect = document.getElementById('consume-deployment-id');
    const returnDepSelect = document.getElementById('return-deployment-id');
    const payDepSelect = document.getElementById('pay-deployment-id');
    if (!consumeDepSelect || !returnDepSelect) return;

    const prevConsumeDep = consumeDepSelect.value;
    const prevReturnDep = returnDepSelect.value;
    const prevPayDep = payDepSelect ? payDepSelect.value : '';

    const consumeTeamSelect = document.getElementById('consume-team');
    const returnTeamSelect = document.getElementById('return-team');
    const payTeamSelect = document.getElementById('pay-team');

    const prevConsumeTeam = consumeTeamSelect ? consumeTeamSelect.value : '';
    const prevReturnTeam = returnTeamSelect ? returnTeamSelect.value : '';
    const prevPayTeam = payTeamSelect ? payTeamSelect.value : '';

    const consumeMatSelect = document.getElementById('consume-material-id');
    const returnMatSelect = document.getElementById('return-material-id');

    const prevConsumeMat = consumeMatSelect ? consumeMatSelect.value : '';
    const prevReturnMat = returnMatSelect ? returnMatSelect.value : '';

    const deployments = store.getDeployments();
    const optionsHtml = '<option value="">Selecione a obra...</option>' + 
      deployments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');

    consumeDepSelect.innerHTML = optionsHtml;
    returnDepSelect.innerHTML = optionsHtml;

    if (payDepSelect) {
      payDepSelect.innerHTML = optionsHtml;
    }

    if (deployments.some(d => d.id === prevConsumeDep)) {
      consumeDepSelect.value = prevConsumeDep;
      this.handleConsumeDeploymentChange(prevConsumeDep);
      if (consumeTeamSelect && prevConsumeTeam) {
        consumeTeamSelect.value = prevConsumeTeam;
        this.handleConsumeTeamChange(prevConsumeDep, prevConsumeTeam);
        if (consumeMatSelect && prevConsumeMat) {
          consumeMatSelect.value = prevConsumeMat;
          this.handleConsumeMaterialChange(prevConsumeDep, prevConsumeTeam, prevConsumeMat);
        }
      }
    } else {
      this.handleConsumeDeploymentChange('');
    }

    if (deployments.some(d => d.id === prevReturnDep)) {
      returnDepSelect.value = prevReturnDep;
      this.handleReturnDeploymentChange(prevReturnDep);
      if (returnTeamSelect && prevReturnTeam) {
        returnTeamSelect.value = prevReturnTeam;
        this.handleReturnTeamChange(prevReturnDep, prevReturnTeam);
        if (returnMatSelect && prevReturnMat) {
          returnMatSelect.value = prevReturnMat;
          this.handleReturnMaterialChange(prevReturnDep, prevReturnTeam, prevReturnMat);
        }
      }
    } else {
      this.handleReturnDeploymentChange('');
    }

    if (payDepSelect) {
      if (deployments.some(d => d.id === prevPayDep)) {
        payDepSelect.value = prevPayDep;
        this.handlePayDeploymentChange(prevPayDep);
        if (payTeamSelect && prevPayTeam) {
          payTeamSelect.value = prevPayTeam;
        }
      } else {
        this.handlePayDeploymentChange('');
      }
    }
  }

  handlePayDeploymentChange(deploymentId) {
    const teamSelect = document.getElementById('pay-team');
    if (!teamSelect) return;

    teamSelect.innerHTML = '<option value="">Selecione a equipe...</option>';

    if (!deploymentId) return;

    const teams = store.getTeams();
    teamSelect.innerHTML = '<option value="">Selecione a equipe...</option>' + 
      teams.map(t => `<option value="${t.name}">${t.name} (Líder: ${t.responsible})</option>`).join('');
  }

  handleConsumeDeploymentChange(deploymentId) {
    const teamSelect = document.getElementById('consume-team');
    const matSelect = document.getElementById('consume-material-id');
    const helper = document.getElementById('consume-balance-helper');
    if (!teamSelect || !matSelect || !helper) return;

    teamSelect.innerHTML = '<option value="">Selecione a equipe...</option>';
    matSelect.innerHTML = '<option value="">Selecione o material...</option>';
    helper.style.display = 'none';

    if (!deploymentId) return;

    const teams = store.getTeamsForDeployment(deploymentId);
    teamSelect.innerHTML = '<option value="">Selecione a equipe...</option>' + 
      teams.map(t => `<option value="${t}">${t}</option>`).join('');
  }

  handleConsumeTeamChange(deploymentId, team) {
    const matSelect = document.getElementById('consume-material-id');
    const helper = document.getElementById('consume-balance-helper');
    if (!matSelect || !helper) return;

    matSelect.innerHTML = '<option value="">Selecione o material...</option>';
    helper.style.display = 'none';

    if (!deploymentId || !team) return;

    const materials = store.getMaterialsForTeam(deploymentId, team);
    const activeMaterials = materials.filter(m => m.balance > 0);
    matSelect.innerHTML = '<option value="">Selecione o material...</option>' + 
      activeMaterials.map(m => `<option value="${m.id}">${m.name} (Posse: ${m.balance} ${DEFAULT_UNITS[m.unit].toLowerCase()})</option>`).join('');
  }

  handleConsumeMaterialChange(deploymentId, team, materialId) {
    const helper = document.getElementById('consume-balance-helper');
    if (!helper) return;

    if (!deploymentId || !team || !materialId) {
      helper.style.display = 'none';
      return;
    }

    const material = store.getMaterial(materialId);
    const possession = store.getTeamPossession(deploymentId, team, materialId);
    if (material && possession) {
      helper.innerHTML = `Saldo com Equipe: <strong>${possession.balance} ${DEFAULT_UNITS[material.unit].toLowerCase()}</strong> (Entregue: ${possession.delivered} | Usado: ${possession.consumed} | Devolvido: ${possession.returned})`;
      helper.style.display = 'block';
    } else {
      helper.style.display = 'none';
    }
  }

  handleReturnDeploymentChange(deploymentId) {
    const teamSelect = document.getElementById('return-team');
    const matSelect = document.getElementById('return-material-id');
    const helper = document.getElementById('return-balance-helper');
    if (!teamSelect || !matSelect || !helper) return;

    teamSelect.innerHTML = '<option value="">Selecione a equipe...</option>';
    matSelect.innerHTML = '<option value="">Selecione o material...</option>';
    helper.style.display = 'none';

    if (!deploymentId) return;

    const teams = store.getTeamsForDeployment(deploymentId);
    teamSelect.innerHTML = '<option value="">Selecione a equipe...</option>' + 
      teams.map(t => `<option value="${t}">${t}</option>`).join('');
  }

  handleReturnTeamChange(deploymentId, team) {
    const matSelect = document.getElementById('return-material-id');
    const helper = document.getElementById('return-balance-helper');
    if (!matSelect || !helper) return;

    matSelect.innerHTML = '<option value="">Selecione o material...</option>';
    helper.style.display = 'none';

    if (!deploymentId || !team) return;

    const materials = store.getMaterialsForTeam(deploymentId, team);
    const activeMaterials = materials.filter(m => m.balance > 0);
    matSelect.innerHTML = '<option value="">Selecione o material...</option>' + 
      activeMaterials.map(m => `<option value="${m.id}">${m.name} (Posse: ${m.balance} ${DEFAULT_UNITS[m.unit].toLowerCase()})</option>`).join('');
  }

  handleReturnMaterialChange(deploymentId, team, materialId) {
    const helper = document.getElementById('return-balance-helper');
    if (!helper) return;

    if (!deploymentId || !team || !materialId) {
      helper.style.display = 'none';
      return;
    }

    const material = store.getMaterial(materialId);
    const possession = store.getTeamPossession(deploymentId, team, materialId);
    if (material && possession) {
      helper.innerHTML = `Saldo com Equipe: <strong>${possession.balance} ${DEFAULT_UNITS[material.unit].toLowerCase()}</strong> (Entregue: ${possession.delivered} | Usado: ${possession.consumed} | Devolvido: ${possession.returned})`;
      helper.style.display = 'block';
    } else {
      helper.style.display = 'none';
    }
  }

  populateReportDropdown() {
    const depSelect = document.getElementById('report-deployment-id');
    if (!depSelect) return;

    const prevVal = depSelect.value;
    const deployments = store.getDeployments();
    depSelect.innerHTML = '<option value="">Selecione o lançamento...</option>' + 
      deployments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');

    if (deployments.some(d => d.id === prevVal)) {
      depSelect.value = prevVal;
    }
  }

  // --- Renderizadores da Fase 3 ---

  renderDeliveries() {
    const tbody = document.getElementById('deliveries-tbody');
    if (!tbody) return;

    const list = store.getDeliveries();

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-secondary" style="padding: 32px;">
            Nenhuma entrega registrada ainda. Preencha o formulário acima para enviar materiais a campo!
          </td>
        </tr>
      `;
      return;
    }

    const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = sorted.map(d => {
      const dep = store.getDeployment(d.deploymentId);
      const mat = store.getMaterial(d.materialId);
      const depName = dep ? dep.name : 'Obra Removida';
      const matName = mat ? mat.name : 'Material Removido';
      const unit = mat ? DEFAULT_UNITS[mat.unit].toLowerCase() : '';
      const dateFormatted = new Date(d.date + 'T00:00:00').toLocaleDateString('pt-BR');

      return `
        <tr>
          <td><strong>${depName}</strong></td>
          <td>${d.team}</td>
          <td>${matName}</td>
          <td><strong>${d.quantity.toLocaleString('pt-BR')}</strong> ${unit}</td>
          <td>${dateFormatted}</td>
          <td style="font-size:12px; font-style:italic;" title="${d.notes}">${d.notes || '-'}</td>
          <td style="text-align: right;">
            <div class="flex-align" style="justify-content: flex-end; gap: 4px;">
              <button type="button" class="btn-icon" title="Editar Entrega" onclick="appView.openDeliveryEditModal('${d.id}')">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-icon delete-btn" title="Excluir Entrega" onclick="appView.handleDeliveryDelete('${d.id}')">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  renderFieldOps() {
    this.renderTeamBalances();
    this.renderConsumptionsList();
    this.renderReturnsList();
    this.renderLaborPaymentsList();
  }

  renderTeamBalances() {
    const tbody = document.getElementById('balances-tbody');
    if (!tbody) return;

    const deliveries = store.getDeliveries();
    
    if (deliveries.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-secondary" style="padding: 32px;">
            Nenhum material foi entregue às equipes ainda. Os saldos de posse aparecerão aqui.
          </td>
        </tr>
      `;
      return;
    }

    const combinations = [];
    const keys = new Set();

    deliveries.forEach(d => {
      const key = `${d.deploymentId}|||${d.team}|||${d.materialId}`;
      if (!keys.has(key)) {
        keys.add(key);
        combinations.push({
          deploymentId: d.deploymentId,
          team: d.team,
          materialId: d.materialId
        });
      }
    });

    let html = '';
    combinations.forEach(combo => {
      const dep = store.getDeployment(combo.deploymentId);
      const mat = store.getMaterial(combo.materialId);
      if (!dep || !mat) return;

      const possession = store.getTeamPossession(combo.deploymentId, combo.team, combo.materialId);
      
      if (possession.delivered === 0) return;

      const unit = DEFAULT_UNITS[mat.unit].toLowerCase();
      const valuer = possession.balance * mat.unitValue;

      let balStyle = '';
      if (possession.balance > 0) {
        balStyle = 'color:var(--color-success); font-weight:700;';
      } else if (possession.balance < 0) {
        balStyle = 'color:var(--color-danger); font-weight:700;';
      } else {
        balStyle = 'color:var(--text-secondary);';
      }

      html += `
        <tr>
          <td><strong>${dep.name}</strong></td>
          <td>${combo.team}</td>
          <td>${mat.name}</td>
          <td>${possession.delivered.toLocaleString('pt-BR')} ${unit}</td>
          <td>${possession.consumed.toLocaleString('pt-BR')} ${unit}</td>
          <td>${possession.returned.toLocaleString('pt-BR')} ${unit}</td>
          <td style="${balStyle}">${possession.balance.toLocaleString('pt-BR')} ${unit}</td>
          <td style="font-weight:600;">R$ ${valuer.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html || `
      <tr>
        <td colspan="8" class="text-center text-secondary" style="padding: 32px;">
          Nenhum saldo ativo em campo.
        </td>
      </tr>
    `;
  }

  renderConsumptionsList() {
    const tbody = document.getElementById('consumptions-tbody');
    if (!tbody) return;

    const list = store.getConsumptions();

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-secondary" style="padding: 16px;">
            Nenhum consumo registrado ainda.
          </td>
        </tr>
      `;
      return;
    }

    const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = sorted.map(c => {
      const mat = store.getMaterial(c.materialId);
      const matName = mat ? mat.name : 'Material Removido';
      const unit = mat ? DEFAULT_UNITS[mat.unit].toLowerCase() : '';
      const dateFormatted = new Date(c.date + 'T00:00:00').toLocaleDateString('pt-BR');

      return `
        <tr>
          <td><strong>${c.team}</strong></td>
          <td>${matName}</td>
          <td><strong>${c.quantity.toLocaleString('pt-BR')}</strong> ${unit}</td>
          <td>${dateFormatted}</td>
          <td style="text-align: right;">
            <button type="button" class="btn-icon delete-btn" title="Excluir Consumo" onclick="appView.handleConsumptionDelete('${c.id}')">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  // ==========================================
  // CATEGORIAS E UNIDADES DE MEDIDA
  // ==========================================

  openCategoriesModal() {
    this.renderCategoriesList();
    document.getElementById('categories-modal').classList.add('active');
  }

  closeCategoriesModal() {
    document.getElementById('categories-modal').classList.remove('active');
  }

  renderCategoriesList() {
    const list = document.getElementById('categories-list');
    if (!list) return;

    const categories = Object.entries(DEFAULT_CATEGORIES);
    if (categories.length === 0) {
      list.innerHTML = '<p class="text-secondary">Nenhuma categoria cadastrada.</p>';
      return;
    }

    list.innerHTML = categories.map(([key, name]) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
        <span>${name}</span>
        <button type="button" class="btn-icon delete-btn" title="Excluir Categoria" onclick="appView.handleDeleteCategory('${key}')">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    `).join('');
    lucide.createIcons();
  }

  handleAddCategory() {
    const input = document.getElementById('new-category-name');
    const name = input.value.trim();

    if (!name) {
      showToast('Digite um nome para a categoria.', 'warning');
      return;
    }

    if (name.length < 3) {
      showToast('O nome da categoria deve ter pelo menos 3 caracteres.', 'warning');
      return;
    }

    const key = name.toLowerCase().replace(/\s+/g, '_');
    
    if (DEFAULT_CATEGORIES[key]) {
      showToast('Esta categoria já existe.', 'warning');
      return;
    }

    DEFAULT_CATEGORIES[key] = name;
    input.value = '';
    this.renderCategoriesList();
    this.updateCategorySelects();
    showToast('Categoria adicionada com sucesso!', 'success');
  }

  handleDeleteCategory(key) {
    if (confirm(`Tem certeza que deseja excluir a categoria "${DEFAULT_CATEGORIES[key]}"?`)) {
      delete DEFAULT_CATEGORIES[key];
      this.renderCategoriesList();
      this.updateCategorySelects();
      showToast('Categoria removida com sucesso!', 'success');
    }
  }

  updateCategorySelects() {
    const selects = document.querySelectorAll('[id*="category"]');
    selects.forEach(select => {
      const current = select.value;
      select.innerHTML = '<option value="">Selecione...</option>' + 
        Object.entries(DEFAULT_CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
      select.value = current;
    });

    const filterSelect = document.getElementById('material-category-filter');
    if (filterSelect) {
      const current = filterSelect.value;
      filterSelect.innerHTML = '<option value="todos">Todas as Categorias</option>' + 
        Object.entries(DEFAULT_CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
      filterSelect.value = current;
    }
  }

  openUnitsModal() {
    this.renderUnitsList();
    document.getElementById('units-modal').classList.add('active');
  }

  closeUnitsModal() {
    document.getElementById('units-modal').classList.remove('active');
  }

  renderUnitsList() {
    const list = document.getElementById('units-list');
    if (!list) return;

    const units = Object.entries(DEFAULT_UNITS);
    if (units.length === 0) {
      list.innerHTML = '<p class="text-secondary">Nenhuma unidade de medida cadastrada.</p>';
      return;
    }

    list.innerHTML = units.map(([key, name]) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
        <span>${name}</span>
        <button type="button" class="btn-icon delete-btn" title="Excluir Unidade" onclick="appView.handleDeleteUnit('${key}')">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    `).join('');
    lucide.createIcons();
  }

  handleAddUnit() {
    const input = document.getElementById('new-unit-name');
    const name = input.value.trim();

    if (!name) {
      showToast('Digite um nome para a unidade.', 'warning');
      return;
    }

    if (name.length < 2) {
      showToast('O nome da unidade deve ter pelo menos 2 caracteres.', 'warning');
      return;
    }

    const key = name.toLowerCase().replace(/\s+/g, '_');
    
    if (DEFAULT_UNITS[key]) {
      showToast('Esta unidade já existe.', 'warning');
      return;
    }

    DEFAULT_UNITS[key] = name;
    input.value = '';
    this.renderUnitsList();
    this.updateUnitSelects();
    showToast('Unidade de medida adicionada com sucesso!', 'success');
  }

  handleDeleteUnit(key) {
    if (confirm(`Tem certeza que deseja excluir a unidade "${DEFAULT_UNITS[key]}"?`)) {
      delete DEFAULT_UNITS[key];
      this.renderUnitsList();
      this.updateUnitSelects();
      showToast('Unidade de medida removida com sucesso!', 'success');
    }
  }

  updateUnitSelects() {
    const selects = document.querySelectorAll('[id*="unit"]');
    selects.forEach(select => {
      const current = select.value;
      select.innerHTML = '<option value="">Selecione...</option>' + 
        Object.entries(DEFAULT_UNITS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
      select.value = current;
    });
  }

  renderReturnsList() {
    const tbody = document.getElementById('returns-tbody');
    if (!tbody) return;

    const list = store.getReturns();

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-secondary" style="padding: 16px;">
            Nenhuma devolução registrada ainda.
          </td>
        </tr>
      `;
      return;
    }

    const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = sorted.map(r => {
      const mat = store.getMaterial(r.materialId);
      const matName = mat ? mat.name : 'Material Removido';
      const unit = mat ? DEFAULT_UNITS[mat.unit].toLowerCase() : '';
      const dateFormatted = new Date(r.date + 'T00:00:00').toLocaleDateString('pt-BR');

      return `
        <tr>
          <td><strong>${r.team}</strong></td>
          <td>${matName}</td>
          <td><strong>${r.quantity.toLocaleString('pt-BR')}</strong> ${unit}</td>
          <td>${dateFormatted}</td>
          <td style="text-align: right;">
            <button type="button" class="btn-icon delete-btn" title="Excluir Devolução" onclick="appView.handleReturnDelete('${r.id}')">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  renderLaborPaymentsList() {
    const tbody = document.getElementById('labor-payments-tbody');
    if (!tbody) return;

    const list = store.getLaborPayments();

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-secondary" style="padding: 16px;">
            Nenhum pagamento de mão de obra registrado ainda.
          </td>
        </tr>
      `;
      return;
    }

    const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = sorted.map(lp => {
      const dateFormatted = new Date(lp.date + 'T00:00:00').toLocaleDateString('pt-BR');
      const valFormatted = lp.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const dep = store.getDeployment(lp.deploymentId);
      const depName = dep ? dep.name : 'Obra Removida';

      return `
        <tr>
          <td>
            <strong>${lp.team}</strong>
            <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">${depName}</div>
          </td>
          <td>${lp.description}</td>
          <td style="color: var(--primary-color); font-weight: 600;">R$ ${valFormatted}</td>
          <td>${dateFormatted}</td>
          <td style="text-align: right;">
            <button type="button" class="btn-icon delete-btn" title="Excluir Pagamento" onclick="appView.handleLaborPaymentDelete('${lp.id}')">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  renderReports(deploymentId) {
    const emptyState = document.getElementById('report-empty-state');
    const metricsGrid = document.getElementById('report-metrics-grid');
    const detailsPanel = document.getElementById('report-details-panel');

    if (!emptyState || !metricsGrid || !detailsPanel) return;

    if (!deploymentId) {
      emptyState.style.display = 'block';
      metricsGrid.style.display = 'none';
      detailsPanel.style.display = 'none';
      return;
    }

    const deployment = store.getDeployment(deploymentId);
    if (!deployment) return;

    emptyState.style.display = 'none';
    metricsGrid.style.display = 'grid';
    detailsPanel.style.display = 'block';

    const plannedCost = store.getDeploymentTotalCost(deployment);
    document.getElementById('report-cost-planned').textContent = `R$ ${plannedCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const consumptions = store.getConsumptions().filter(c => c.deploymentId === deploymentId);
    const realCost = consumptions.reduce((sum, c) => {
      const mat = store.getMaterial(c.materialId);
      return sum + (c.quantity * (mat ? mat.unitValue : 0));
    }, 0);
    document.getElementById('report-cost-real').textContent = `R$ ${realCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const deviation = plannedCost - realCost;
    const devCard = document.getElementById('report-cost-deviation-card');
    const devTitle = document.getElementById('report-cost-deviation-title');
    const devValue = document.getElementById('report-cost-deviation');
    const devIconWrapper = document.getElementById('report-cost-deviation-icon-wrapper');
    const devIcon = document.getElementById('report-cost-deviation-icon');
    const devFooter = document.getElementById('report-cost-deviation-footer');

    if (devCard && devTitle && devValue && devIconWrapper && devIcon && devFooter) {
      if (deviation >= 0) {
        devCard.className = 'metric-card bg-emerald';
        devTitle.textContent = 'Economia Estimada';
        devValue.textContent = `R$ ${deviation.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        devIconWrapper.className = 'metric-icon-wrapper bg-light-emerald';
        devIcon.className = 'icon-emerald';
        devIcon.setAttribute('data-lucide', 'arrow-down-right');
        devFooter.textContent = 'Abaixo do planejado';
      } else {
        devCard.className = 'metric-card bg-red';
        devTitle.textContent = 'Estouro de Custo';
        devValue.textContent = `-R$ ${Math.abs(deviation).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        devIconWrapper.className = 'metric-icon-wrapper bg-light-red';
        devIcon.className = 'icon-red';
        devIcon.setAttribute('data-lucide', 'arrow-up-right');
        devFooter.textContent = 'Acima do planejado';
      }
    }

    let totalFiberMetersUsed = 0;
    let totalFiberCostUsed = 0;

    consumptions.forEach(c => {
      const mat = store.getMaterial(c.materialId);
      if (mat && mat.category === 'cabos' && mat.unit === 'metro') {
        totalFiberMetersUsed += c.quantity;
        totalFiberCostUsed += c.quantity * mat.unitValue;
      }
    });

    const fiberCard = document.getElementById('report-fiber-cost-card');
    const fiberCostText = document.getElementById('report-fiber-cost');
    const fiberFooter = fiberCard ? fiberCard.querySelector('.metric-subtext') : null;

    if (fiberCard && fiberCostText) {
      if (totalFiberMetersUsed > 0) {
        const costPerMeter = totalFiberCostUsed / totalFiberMetersUsed;
        fiberCard.style.opacity = '1';
        fiberCostText.textContent = `R$ ${costPerMeter.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / m`;
        if (fiberFooter) {
          fiberFooter.textContent = `Total: ${totalFiberMetersUsed.toLocaleString('pt-BR')} metros usados`;
        }
      } else {
        fiberCard.style.opacity = '0.5';
        fiberCostText.textContent = 'N/A';
        if (fiberFooter) {
          fiberFooter.textContent = 'Nenhum cabo em metros usado';
        }
      }
    }

    const tbody = document.getElementById('report-details-panel').querySelector('#audit-tbody');
    const tfoot = document.getElementById('report-details-panel').querySelector('#audit-tfoot');
    if (!tbody || !tfoot) return;

    const materialIds = new Set();
    deployment.plannedMaterials.forEach(p => materialIds.add(p.materialId));
    store.getDeliveries().filter(d => d.deploymentId === deploymentId).forEach(d => materialIds.add(d.materialId));
    store.getConsumptions().filter(c => c.deploymentId === deploymentId).forEach(c => materialIds.add(c.materialId));
    store.getReturns().filter(r => r.deploymentId === deploymentId).forEach(r => materialIds.add(r.materialId));

    if (materialIds.size === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-secondary" style="padding: 32px;">
            Nenhuma movimentação ou planejamento de materiais registrado para esta obra.
          </td>
        </tr>
      `;
      tfoot.innerHTML = '';
      lucide.createIcons();
      return;
    }

    const matList = Array.from(materialIds).map(mId => {
      const mat = store.getMaterial(mId);
      return {
        id: mId,
        name: mat ? mat.name : 'Material Removido',
        unit: mat ? mat.unit : 'unidade',
        unitValue: mat ? mat.unitValue : 0
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    let sumPlannedQty = 0;
    let sumDeliveredQty = 0;
    let sumUsedQty = 0;
    let sumReturnedQty = 0;
    let sumDiffQty = 0;
    let sumFieldQty = 0;
    let sumRealCost = 0;

    tbody.innerHTML = matList.map(mat => {
      const planItem = deployment.plannedMaterials.find(p => p.materialId === mat.id);
      const planQty = planItem ? planItem.quantity : 0;

      const dels = store.getDeliveries().filter(d => d.deploymentId === deploymentId && d.materialId === mat.id);
      const cons = store.getConsumptions().filter(c => c.deploymentId === deploymentId && c.materialId === mat.id);
      const rets = store.getReturns().filter(r => r.deploymentId === deploymentId && r.materialId === mat.id);

      const totalDel = dels.reduce((sum, d) => sum + d.quantity, 0);
      const totalCon = cons.reduce((sum, c) => sum + c.quantity, 0);
      const totalRet = rets.reduce((sum, r) => sum + r.quantity, 0);

      const fieldBal = totalDel - totalCon - totalRet;
      const diffPlanUsed = planQty - totalCon;
      const itemRealCostVal = totalCon * mat.unitValue;

      sumPlannedQty += planQty;
      sumDeliveredQty += totalDel;
      sumUsedQty += totalCon;
      sumReturnedQty += totalRet;
      sumDiffQty += diffPlanUsed;
      sumFieldQty += fieldBal;
      sumRealCost += itemRealCostVal;

      const unit = DEFAULT_UNITS[mat.unit].toLowerCase();

      let diffStyle = '';
      if (diffPlanUsed > 0) {
        diffStyle = 'color:var(--color-success); font-weight:500;';
      } else if (diffPlanUsed < 0) {
        diffStyle = 'color:var(--color-danger); font-weight:500;';
      }

      let fieldStyle = fieldBal > 0 ? 'font-weight:700; color:var(--color-secondary);' : '';

      return `
        <tr>
          <td style="font-weight:600;">${mat.name}</td>
          <td>${planQty > 0 ? `${planQty.toLocaleString('pt-BR')} ${unit}` : '-'}</td>
          <td>${totalDel > 0 ? `${totalDel.toLocaleString('pt-BR')} ${unit}` : '-'}</td>
          <td>${totalCon > 0 ? `${totalCon.toLocaleString('pt-BR')} ${unit}` : '-'}</td>
          <td>${totalRet > 0 ? `${totalRet.toLocaleString('pt-BR')} ${unit}` : '-'}</td>
          <td style="${diffStyle}">${diffPlanUsed !== 0 ? `${diffPlanUsed.toLocaleString('pt-BR')} ${unit}` : '-'}</td>
          <td style="${fieldStyle}">${fieldBal > 0 ? `${fieldBal.toLocaleString('pt-BR')} ${unit}` : '-'}</td>
          <td style="font-weight:700;">R$ ${itemRealCostVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>
      `;
    }).join('');

    tfoot.innerHTML = `
      <tr style="background-color:rgba(255,255,255,0.02); font-weight:800; border-top: 2px solid var(--border-color);">
        <td>TOTAIS DA OBRA</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td style="color:var(--color-success); font-size:16px;">R$ ${sumRealCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    `;

    lucide.createIcons();
  }

  // --- Handlers de Transações (Fase 3) ---

  handleDeliverySubmit(e) {
    e.preventDefault();

    const depEl = document.getElementById('delivery-deployment-id');
    const teamEl = document.getElementById('delivery-team');
    const matEl = document.getElementById('delivery-material-id');
    const qtyEl = document.getElementById('delivery-qty');
    const dateEl = document.getElementById('delivery-date');
    const notesEl = document.getElementById('delivery-notes');

    let isValid = true;
    isValid = this.validateField(depEl, depEl.value !== '') && isValid;
    isValid = this.validateField(teamEl, teamEl.value.trim().length >= 3) && isValid;
    isValid = this.validateField(matEl, matEl.value !== '') && isValid;

    const qtyVal = parseFloat(qtyEl.value);
    isValid = this.validateField(qtyEl, !isNaN(qtyVal) && qtyVal > 0) && isValid;
    isValid = this.validateField(dateEl, dateEl.value !== '') && isValid;

    if (!isValid) {
      showToast('Por favor, corrija os erros no cadastro de entrega.', 'error');
      return;
    }

    try {
      store.addDelivery({
        deploymentId: depEl.value,
        team: teamEl.value.trim(),
        materialId: matEl.value,
        quantity: qtyVal,
        date: dateEl.value,
        notes: notesEl.value ? notesEl.value.trim() : ''
      });

      showToast('Material entregue à equipe com sucesso!', 'success');
      
      document.getElementById('delivery-form').reset();
      this.clearFormErrors('delivery-form');
      document.getElementById('delivery-stock-helper').style.display = 'none';

      this.renderDeliveries();
      this.populateDeliveryDropdowns();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  openDeliveryEditModal(id) {
    const delivery = store.getDelivery(id);
    if (!delivery) return;

    const deployment = store.getDeployment(delivery.deploymentId);
    const material = store.getMaterial(delivery.materialId);
    if (!deployment || !material) return;

    this.clearFormErrors('delivery-edit-form');

    document.getElementById('edit-delivery-id').value = delivery.id;
    document.getElementById('edit-delivery-deployment-text').value = deployment.name;
    document.getElementById('edit-delivery-team').value = delivery.team;
    document.getElementById('edit-delivery-material-text').value = material.name;
    document.getElementById('edit-delivery-qty').value = delivery.quantity;
    document.getElementById('edit-delivery-date').value = delivery.date;
    document.getElementById('edit-delivery-notes').value = delivery.notes || '';

    const maxAllowed = material.quantity + delivery.quantity;
    const helper = document.getElementById('edit-delivery-stock-helper');
    if (helper) {
      helper.innerHTML = `Disponível Almoxarifado: <strong>${material.quantity}</strong> | Máx. permitido para reajuste: <strong>${maxAllowed} ${DEFAULT_UNITS[material.unit].toLowerCase()}</strong>`;
    }

    document.getElementById('delivery-edit-modal').classList.add('active');
  }

  closeDeliveryEditModal() {
    document.getElementById('delivery-edit-modal').classList.remove('active');
  }

  handleDeliveryEditSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('edit-delivery-id').value;
    const teamEl = document.getElementById('edit-delivery-team');
    const qtyEl = document.getElementById('edit-delivery-qty');
    const dateEl = document.getElementById('edit-delivery-date');
    const notesEl = document.getElementById('edit-delivery-notes');

    if (!id) return;

    let isValid = true;
    isValid = this.validateField(teamEl, teamEl.value.trim().length >= 3) && isValid;

    const qtyVal = parseFloat(qtyEl.value);
    isValid = this.validateField(qtyEl, !isNaN(qtyVal) && qtyVal > 0) && isValid;
    isValid = this.validateField(dateEl, dateEl.value !== '') && isValid;

    if (!isValid) {
      showToast('Preencha os campos obrigatórios para reajustar a entrega.', 'error');
      return;
    }

    try {
      store.updateDelivery(id, {
        team: teamEl.value.trim(),
        quantity: qtyVal,
        date: dateEl.value,
        notes: notesEl.value ? notesEl.value.trim() : ''
      });

      showToast('Registro de entrega reajustado com sucesso!', 'success');
      this.closeDeliveryEditModal();
      this.renderDeliveries();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  handleDeliveryDelete(id) {
    const delivery = store.getDelivery(id);
    if (!delivery) return;

    const mat = store.getMaterial(delivery.materialId);
    const matName = mat ? mat.name : 'material';

    if (confirm(`Deseja realmente estornar a entrega de ${delivery.quantity} ${mat ? DEFAULT_UNITS[mat.unit].toLowerCase() : ''} de "${matName}" para a equipe "${delivery.team}"?\nO material retornará para o estoque físico.`)) {
      try {
        store.deleteDelivery(id);
        showToast('Entrega estornada com sucesso e material devolvido ao almoxarifado.', 'success');
        this.renderDeliveries();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }

  handleConsumptionSubmit(e) {
    e.preventDefault();

    const depEl = document.getElementById('consume-deployment-id');
    const teamEl = document.getElementById('consume-team');
    const matEl = document.getElementById('consume-material-id');
    const qtyEl = document.getElementById('consume-qty');
    const dateEl = document.getElementById('consume-date');
    const respEl = document.getElementById('consume-responsible');

    let isValid = true;
    isValid = this.validateField(depEl, depEl.value !== '') && isValid;
    isValid = this.validateField(teamEl, teamEl.value !== '') && isValid;
    isValid = this.validateField(matEl, matEl.value !== '') && isValid;

    const qtyVal = parseFloat(qtyEl.value);
    isValid = this.validateField(qtyEl, !isNaN(qtyVal) && qtyVal > 0) && isValid;
    isValid = this.validateField(dateEl, dateEl.value !== '') && isValid;
    isValid = this.validateField(respEl, respEl.value.trim().length >= 3) && isValid;

    if (!isValid) {
      showToast('Corrija os erros no formulário de consumo.', 'error');
      return;
    }

    try {
      store.addConsumption({
        deploymentId: depEl.value,
        team: teamEl.value,
        materialId: matEl.value,
        quantity: qtyVal,
        date: dateEl.value,
        responsible: respEl.value.trim()
      });

      showToast('Consumo real registrado com sucesso!', 'success');

      document.getElementById('consumption-form').reset();
      this.clearFormErrors('consumption-form');
      document.getElementById('consume-balance-helper').style.display = 'none';

      this.renderFieldOps();
      this.populateCampoDropdowns();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  handleConsumptionDelete(id) {
    if (confirm('Deseja realmente excluir este registro de consumo?\nIsso reverterá a quantidade de volta ao saldo em posse da equipe.')) {
      try {
        store.deleteConsumption(id);
        showToast('Registro de consumo removido.', 'info');
        this.renderFieldOps();
        this.populateCampoDropdowns();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }

  handleReturnSubmit(e) {
    e.preventDefault();

    const depEl = document.getElementById('return-deployment-id');
    const teamEl = document.getElementById('return-team');
    const matEl = document.getElementById('return-material-id');
    const qtyEl = document.getElementById('return-qty');
    const dateEl = document.getElementById('return-date');
    const notesEl = document.getElementById('return-notes');

    let isValid = true;
    isValid = this.validateField(depEl, depEl.value !== '') && isValid;
    isValid = this.validateField(teamEl, teamEl.value !== '') && isValid;
    isValid = this.validateField(matEl, matEl.value !== '') && isValid;

    const qtyVal = parseFloat(qtyEl.value);
    isValid = this.validateField(qtyEl, !isNaN(qtyVal) && qtyVal > 0) && isValid;
    isValid = this.validateField(dateEl, dateEl.value !== '') && isValid;

    if (!isValid) {
      showToast('Corrija os erros no formulário de devolução.', 'error');
      return;
    }

    try {
      store.addReturn({
        deploymentId: depEl.value,
        team: teamEl.value,
        materialId: matEl.value,
        quantity: qtyVal,
        date: dateEl.value,
        notes: notesEl.value ? notesEl.value.trim() : ''
      });

      showToast('Material devolvido e reincorporado ao estoque do almoxarifado!', 'success');

      document.getElementById('return-form').reset();
      this.clearFormErrors('return-form');
      document.getElementById('return-balance-helper').style.display = 'none';

      this.renderFieldOps();
      this.populateCampoDropdowns();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  handleReturnDelete(id) {
    if (confirm('Deseja realmente estornar esta devolução?\nIsso re-deduzirá o material do estoque físico do almoxarifado para devolver à posse da equipe.')) {
      try {
        store.deleteReturn(id);
        showToast('Devolução estornada com sucesso.', 'info');
        this.renderFieldOps();
        this.populateCampoDropdowns();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }

  handleLaborPaymentSubmit(e) {
    e.preventDefault();

    const depEl = document.getElementById('pay-deployment-id');
    const teamEl = document.getElementById('pay-team');
    const descEl = document.getElementById('pay-description');
    const qtyEl = document.getElementById('pay-qty');
    const dateEl = document.getElementById('pay-date');

    if (!depEl || !teamEl || !descEl || !qtyEl || !dateEl) return;

    let isValid = true;
    isValid = this.validateField(depEl, depEl.value !== '') && isValid;
    isValid = this.validateField(teamEl, teamEl.value !== '') && isValid;
    isValid = this.validateField(descEl, descEl.value.trim().length >= 3) && isValid;

    const valVal = parseFloat(qtyEl.value);
    isValid = this.validateField(qtyEl, !isNaN(valVal) && valVal > 0) && isValid;
    isValid = this.validateField(dateEl, dateEl.value !== '') && isValid;

    if (!isValid) {
      showToast('Corrija os erros no formulário de pagamento.', 'error');
      return;
    }

    try {
      store.addLaborPayment({
        deploymentId: depEl.value,
        team: teamEl.value,
        description: descEl.value.trim(),
        value: valVal,
        date: dateEl.value
      });

      showToast('Pagamento de mão de obra registrado com sucesso!', 'success');

      const paymentForm = document.getElementById('labor-payment-form');
      if (paymentForm) {
        paymentForm.reset();
        this.clearFormErrors('labor-payment-form');
      }

      this.renderFieldOps();
      this.populateCampoDropdowns();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  handleLaborPaymentDelete(id) {
    if (confirm('Deseja realmente excluir este registro de pagamento de mão de obra?')) {
      try {
        store.deleteLaborPayment(id);
        showToast('Registro de pagamento de mão de obra removido.', 'info');
        this.renderFieldOps();
        this.populateCampoDropdowns();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }
}

// Instantiate View Controller
const appView = new AppView();
window.appView = appView; // Make globally accessible for HTML bindings


// ==========================================
// HAMBURGER MENU TOGGLE
// ==========================================
(function initHamburger() {
  const sidebar  = document.getElementById('sidebar');
  const btn      = document.getElementById('btn-hamburger');
  if (!sidebar || !btn) return;

  // Restore saved state
  const isSaved = localStorage.getItem('fibradeploy_sidebar_collapsed') === 'true';
  if (isSaved) sidebar.classList.add('collapsed');

  btn.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('fibradeploy_sidebar_collapsed', isCollapsed);

    // Re-render icons after transition so lucide renders in new size
    setTimeout(() => {
      if (window.lucide) lucide.createIcons();
    }, 300);
  });
})();
