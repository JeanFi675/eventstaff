import { ApiService } from '../../services/api.js';

/**
 * Module for managing volunteer profiles.
 * @namespace ProfilesModule
 */
export const ProfilesModule = {
  profiles: [],
  loading: false, // State used during deletion

  /**
   * Loads profiles for the current user.
   */
  async loadProfiles() {
    if (!this.user) return;

    try {
      const { data, error } = await ApiService.fetch('benevoles', {
        select: '*, benevole_repas(*)',
        eq: { user_id: this.user.id },
        order: { column: 'created_at', ascending: true },
      });

      if (error) throw error;
      this.profiles = data || [];

      // Auto-open logic is now handled by WizardModule.checkWizardAutoOpen()
    } catch (error) {
      console.error('Erreur chargement profils:', error);
    }
  },

  /**
   * Deletes a profile.
   * @param {string} profileId - The ID of the profile to delete.
   */
  async deleteProfile(profileId) {
    if (
      !(await this.askConfirm(
        'Êtes-vous sûr de vouloir supprimer ce profil ? Cette action est irréversible.',
        'Suppression'
      ))
    )
      return;

    this.loading = true;
    try {
      const { error } = await ApiService.delete('benevoles', { id: profileId });

      if (error) throw error;

      this.showToast('✅ Profil supprimé', 'success');
      await this.loadProfiles();

      // Refresh postes to update counts
      if (this.loadPostes) await this.loadPostes();
    } catch (error) {
      this.showToast('❌ Erreur : ' + error.message, 'error');
    } finally {
      this.loading = false;
    }
  },
};
