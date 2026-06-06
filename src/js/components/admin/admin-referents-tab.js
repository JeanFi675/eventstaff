/**
 * Onglet "Attribution des Postes aux Référents" — Phase 5.2.5 (C3.a).
 *
 * Composant Alpine.data autonome. State partagé (`referentAssignments`,
 * `postes`, `periodes`, liste des référents, dérivés) résident dans
 * `Alpine.store('admin')` ; ce composant porte les méthodes de l'UI :
 *  - mutations locales de lignes (add/remove),
 *  - dérivations spécifiques à l'onglet (`getPeriodesForTitre`, `getOrphanPostes`),
 *  - persistance (`saveReferentAssignments`) qui mute `postes[i].referent_id`
 *    en local + appel API.
 */

import Alpine from 'alpinejs';
import { ApiService } from '../../services/api.js';

export function adminReferentsTab() {
  return {
    // --- State local ---
    // Statut de l'encart de sauvegarde (top-right). Pattern aligné sur
    // tab-visual-creator (`autoSaveStatus` ∈ 'synced' | 'saving' | 'error').
    autoSaveStatus: 'synced',

    // --- Proxies de lecture vers le store (résolution scope template) ---

    get referentAssignments() {
      return Alpine.store('admin').referentAssignments;
    },

    get uniquePosteTitres() {
      // Source canonique : table `type_postes` (permet d'attribuer un référent
      // à un type de poste même sans créneau encore créé).
      return Alpine.store('admin').posteTitres;
    },

    // Titres proposables dans une liste déroulante : on ne garde que les types
    // ayant **au moins un créneau sans référent** (sinon inutile de les
    // proposer — tout est déjà attribué). Le titre déjà sélectionné sur la
    // ligne courante est toujours conservé pour ne pas vider le `<select>`.
    getAvailablePosteTitres(currentTitre) {
      const store = Alpine.store('admin');
      const titresAvecCreneauLibre = new Set(
        store.postes.filter((p) => !p.referent_id).map((p) => p.titre)
      );
      return this.uniquePosteTitres.filter(
        (titre) => titre === currentTitre || titresAvecCreneauLibre.has(titre)
      );
    },

    getReferents() {
      return Alpine.store('admin').getReferents();
    },

    initReferentAssignments() {
      Alpine.store('admin').initReferentAssignments();
    },

    // --- Mutations locales sur les lignes d'assignation ---

    addReferentAssignmentLine(refId) {
      const store = Alpine.store('admin');
      if (!store.referentAssignments[refId]) {
        store.referentAssignments[refId] = [];
      }
      store.referentAssignments[refId].push({ titre: '', periodes: [] });
    },

    removeReferentAssignmentLine(refId, index) {
      const store = Alpine.store('admin');
      if (store.referentAssignments[refId]) {
        store.referentAssignments[refId].splice(index, 1);
        this.saveReferentAssignments(refId);
      }
    },

    // --- Dérivations pour le rendu ---

    // Retourne les périodes disponibles pour un titre donné, enrichies d'un
    // marqueur `takenBy` (= référent autre que celui de la ligne) afin que
    // l'UI puisse griser et désactiver les créneaux déjà pris. Sans cette
    // protection, cocher un slot déjà pris écraserait silencieusement
    // l'assignation de l'autre référent (cf. saveReferentAssignments).
    getPeriodesForTitre(titre, currentRefId) {
      if (!titre) return [];
      const store = Alpine.store('admin');
      const postesAvecCeTitre = store.postes.filter((p) => p.titre === titre);
      const periodesIds = new Set(postesAvecCeTitre.map((p) => p.periode_id));
      return store.periodes
        .filter((p) => periodesIds.has(p.id))
        .map((periode) => {
          const poste = postesAvecCeTitre.find((p) => p.periode_id === periode.id);
          let takenBy = null;
          if (poste && poste.referent_id && poste.referent_id !== currentRefId) {
            const ref = store.benevoles.find((b) => b.id === poste.referent_id);
            if (ref) {
              takenBy = { id: ref.id, fullName: `${ref.prenom} ${ref.nom}` };
            }
          }
          return { id: periode.id, nom: periode.nom, ordre: periode.ordre, takenBy };
        });
    },

    getOrphanPostes() {
      const store = Alpine.store('admin');
      const orphans = {};
      store.postes.forEach((p) => {
        if (!p.referent_id) {
          if (!orphans[p.titre]) orphans[p.titre] = [];
          const periode = store.periodes.find((per) => per.id === p.periode_id);
          if (periode && !orphans[p.titre].some((per) => per.id === p.periode_id)) {
            orphans[p.titre].push(periode);
          }
        }
      });
      return Object.entries(orphans)
        .map(([titre, periodes]) => {
          periodes.sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
          return { titre, periodes };
        })
        .sort((a, b) => a.titre.localeCompare(b.titre));
    },

    // --- Persistance ---

    async saveReferentAssignments(refId) {
      const store = Alpine.store('admin');
      this.autoSaveStatus = 'saving';
      try {
        const assignments = store.referentAssignments[refId] || [];

        // Les lignes incomplètes sont ignorées silencieusement : l'utilisateur
        // peut être en train de décocher la dernière case ou d'ajouter une ligne.

        // 1. Postes actuellement assignés à ce référent
        const oldRefPostes = store.postes.filter((p) => p.referent_id === refId);

        // 2. Postes à assigner désormais à ce référent (matching titre + periode_id)
        const newRefPosteIds = new Set();
        for (const a of assignments) {
          for (const pid of a.periodes) {
            const matchingPoste = store.postes.find(
              (p) => p.titre === a.titre && p.periode_id === pid
            );
            if (matchingPoste) {
              newRefPosteIds.add(matchingPoste.id);
            }
          }
        }

        // 3. Diff et exécution
        const updates = [];

        for (const oldP of oldRefPostes) {
          if (!newRefPosteIds.has(oldP.id)) {
            updates.push(ApiService.update('postes', { referent_id: null }, { id: oldP.id }));
            const localP = store.postes.find((p) => p.id === oldP.id);
            if (localP) localP.referent_id = null;
          }
        }

        for (const newPid of newRefPosteIds) {
          updates.push(ApiService.update('postes', { referent_id: refId }, { id: newPid }));
          const localP = store.postes.find((p) => p.id === newPid);
          if (localP) localP.referent_id = refId;
        }

        if (updates.length > 0) {
          await Promise.all(updates);
        }
        this.autoSaveStatus = 'synced';
      } catch (error) {
        this.autoSaveStatus = 'error';
        console.error(error);
        store.showToast('❌ Erreur : ' + error.message, 'error');
      }
    },
  };
}
