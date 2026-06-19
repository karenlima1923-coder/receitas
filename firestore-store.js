/* ============================================================================
   firestore-store.js  —  Implementação Firestore da interface RecipeStore
   ----------------------------------------------------------------------------
   COMO MIGRAR DO IndexedDB PARA O FIRESTORE (3 passos):

   1) No index.html, dentro do <head>, adicione o SDK do Firebase (v9 modular)
      e este arquivo, como módulos:

        <script type="module">
          import { FirestoreStore } from './firestore-store.js';
          window.FirestoreStore = FirestoreStore;
        </script>

   2) Preencha o firebaseConfig abaixo com os dados do seu projeto
      (Console do Firebase → Configurações do projeto → Seus apps).

   3) No index.html, na função boot(), troque a linha marcada [TROCAR AQUI]:

        // store = new IndexedDBStore(); await store.init();
        store = new FirestoreStore(firebaseConfig); await store.init();

   Pronto. Nenhuma outra parte do app muda — todos os métodos têm a mesma
   assinatura da IndexedDBStore (getRecipes, saveRecipe, toggleFavorite, etc.).

   Modelo de dados no Firestore:
     coleção "categorias"  → documento por categoria (id = slug)
     coleção "receitas"    → documento por receita   (id = autoId)
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// 🔧 Configuração do projeto Firebase (receitas-a9c08)
export const firebaseConfig = {
  apiKey: "AIzaSyDXnLrHg8z5PtH3orG_BgxBneNqK6xWORc",
  authDomain: "receitas-a9c08.firebaseapp.com",
  projectId: "receitas-a9c08",
  storageBucket: "receitas-a9c08.firebasestorage.app",
  messagingSenderId: "908016050938",
  appId: "1:908016050938:web:25a9059f401954cad9df43",
  measurementId: "G-82X2NSGFYJ"
};

export class FirestoreStore /* implements RecipeStore */ {
  constructor(config = firebaseConfig) {
    this.app = initializeApp(config);
    this.db = getFirestore(this.app);
  }
  async init() { /* nada a fazer: conexão é sob demanda */ }

  async seedIfEmpty(cats, recipes, users) {
    const snap = await getDocs(collection(this.db, "receitas"));
    if (snap.empty) {                              // ainda não há receitas → popula
      for (const c of cats) await setDoc(doc(this.db, "categorias", c.slug), c);
      for (const r of recipes) {
        const { id, ...rest } = r;                 // deixa o Firestore gerar o id
        await addDoc(collection(this.db, "receitas"), { ...rest, criadoEm: Date.now() });
      }
    }
    if (users) {
      const us = await getDocs(collection(this.db, "usuarios"));
      if (us.empty) for (const u of users) await setDoc(doc(this.db, "usuarios", u.id), u);
    }
  }

  async getCategories() {
    const snap = await getDocs(collection(this.db, "categorias"));
    return snap.docs.map(d => d.data()).sort((a, b) => a.ordem - b.ordem);
  }

  async getRecipes({ categoria, busca, favoritas } = {}) {
    // Filtros simples no servidor; busca textual no cliente (Firestore não faz "contains").
    let q = collection(this.db, "receitas");
    const conds = [];
    if (categoria) conds.push(where("categoria", "==", categoria));
    if (favoritas) conds.push(where("favorito", "==", true));
    if (conds.length) q = query(q, ...conds);
    const snap = await getDocs(q);
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (busca) {
      const t = busca.toLowerCase();
      list = list.filter(r =>
        r.titulo.toLowerCase().includes(t) ||
        (r.ingredientes || []).some(i => i.toLowerCase().includes(t)));
    }
    return list.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
  }

  async getRecipe(id) {
    const d = await getDoc(doc(this.db, "receitas", id));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  }

  async saveRecipe(rec) {
    if (rec.id) {
      const { id, ...rest } = rec;
      await updateDoc(doc(this.db, "receitas", id), rest);
      return rec;
    }
    const { id, ...rest } = rec;
    const ref = await addDoc(collection(this.db, "receitas"),
      { ...rest, favorito: !!rest.favorito, criadoEm: Date.now() });
    return { id: ref.id, ...rest };
  }

  async deleteRecipe(id) { await deleteDoc(doc(this.db, "receitas", id)); }

  async toggleFavorite(id) {
    const r = await this.getRecipe(id);
    const novo = !r.favorito;
    await updateDoc(doc(this.db, "receitas", id), { favorito: novo });
    return novo;
  }

  async stats() {
    const snap = await getDocs(collection(this.db, "receitas"));
    const l = snap.docs.map(d => d.data());
    const t = l.reduce((s, r) => s + (+r.tempoMin || 0), 0);
    return { total: l.length, tempoMedio: l.length ? Math.round(t / l.length) : 0 };
  }

  /* ---- usuários (coleção "usuarios") ----
     No app real, o login vem do Firebase Auth. O documento em "usuarios" guarda o
     perfil (role/status/planoAte). Marque administradores com custom claims no Auth
     (admin:true) e use isso nas Regras de Segurança — não confie só no campo "role". */
  async getUsers() {
    const snap = await getDocs(collection(this.db, "usuarios"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
  }
  async getUser(id) {
    const d = await getDoc(doc(this.db, "usuarios", id));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  }
  async saveUser(u) {
    if (u.id) { const { id, ...rest } = u; await setDoc(doc(this.db, "usuarios", id), rest, { merge: true }); return u; }
    const { id, ...rest } = u;
    const ref = await addDoc(collection(this.db, "usuarios"), { ...rest, criadoEm: Date.now() });
    return { id: ref.id, ...rest };
  }
  async deleteUser(id) { await deleteDoc(doc(this.db, "usuarios", id)); }

  /* ---- meta/sessão ----
     No app real você NÃO precisa guardar a sessão aqui: o usuário logado vem do
     Firebase Auth (auth.currentUser). Mantido por compatibilidade de interface. */
  async getMeta(k) {
    const d = await getDoc(doc(this.db, "meta", k));
    return d.exists() ? d.data().v : null;
  }
  async setMeta(k, v) { await setDoc(doc(this.db, "meta", k), { v }); }
}

/* ============================================================================
   EXEMPLO de Regras de Segurança do Firestore — cole no Console (aba Regras):
   --------------------------------------------------------------------------
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {

       function meu() {
         return get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data;
       }
       function ehAdmin() {
         return request.auth != null && meu().role == 'admin';
       }
       function acessoAtivo() {
         return request.auth != null && (
           meu().role == 'admin' ||
           (meu().status == 'ativo' && meu().planoAte != null
              && meu().planoAte > request.time.toMillis())
         );
       }

       // categorias: todos leem; só admin escreve
       match /categorias/{id} {
         allow read: if true;
         allow write: if ehAdmin();
       }

       // receitas: todos leem; cria só com acesso ativo;
       // edita/exclui se for o dono ou admin
       match /receitas/{id} {
         allow read: if true;
         allow create: if acessoAtivo();
         allow update, delete: if ehAdmin() || resource.data.autorId == request.auth.uid;
       }

       // usuarios: cada um lê o próprio; admin lê todos.
       // o próprio usuário pode CRIAR seu perfil no 1º login, mas só como 'user'
       // (não consegue se autopromover a admin). Suspender/plano/role: só admin.
       match /usuarios/{id} {
         allow read:   if ehAdmin() || request.auth.uid == id;
         allow create: if request.auth.uid == id && request.resource.data.role == 'user';
         allow update, delete: if ehAdmin();
       }
     }
   }
   --------------------------------------------------------------------------
   Imagens: como você usará o plano pago (Storage), restrinja o upload a admin
   nas Regras do Storage. (Opcional/avançado: em vez do campo role, use custom
   claims no Auth via Admin SDK — mais seguro, mas exige uma Cloud Function.)
============================================================================ */


/* ============================================================================
   FirebaseAuthProvider — versão Firebase da camada de login
   ----------------------------------------------------------------------------
   Mesma interface do LocalAuth do index.html (current/login/signup/logout).
   Para usar, no index.html troque:
       auth = new LocalAuth(store);
   por:
       auth = new FirebaseAuthProvider(store);   // store = FirestoreStore
============================================================================ */
export class FirebaseAuthProvider {
  constructor(store){
    this.store = store;
    this.auth = getAuth(store.app);
    // espera o Firebase restaurar a sessão salva antes de o app decidir a tela
    this._ready = new Promise(resolve=>{
      const off = onAuthStateChanged(this.auth, ()=>{ off(); resolve(); });
    });
  }
  async ready(){ return this._ready; }

  // Junta a conta do Auth (uid/e-mail) com o perfil em /usuarios/{uid}
  async _perfil(fbUser){
    if(!fbUser) return null;
    let p = await this.store.getUser(fbUser.uid);
    if(!p){ // primeiro login: cria o perfil
      p = { id: fbUser.uid, nome: fbUser.displayName || fbUser.email,
            email: fbUser.email, role: 'user', status: 'ativo', planoAte: null, criadoEm: Date.now() };
      await setDoc(doc(this.store.db, 'usuarios', fbUser.uid), p);
    }
    return p;
  }
  async current(){ await this._ready; return this._perfil(this.auth.currentUser); }
  async login(email, senha){
    const cred = await signInWithEmailAndPassword(this.auth, email.trim(), senha);
    return this._perfil(cred.user);
  }
  async signup({nome, email, senha}){
    const cred = await createUserWithEmailAndPassword(this.auth, email.trim(), senha);
    const p = { id: cred.user.uid, nome: nome.trim(), email: email.trim(),
                role: 'user', status: 'ativo', planoAte: null, criadoEm: Date.now() };
    await setDoc(doc(this.store.db, 'usuarios', cred.user.uid), p);
    return p;
  }
  async logout(){ await signOut(this.auth); }
}
