// Force cache invalidation - 2026-05-25T03:04:00
import Alpine from 'alpinejs';
import { initStore } from './modules/store.js';
import { cagnotteWidget } from './components/user/cagnotte-widget.js';
import { tshirtWidget } from './components/user/tshirt-widget.js';

// Initialize the central store
initStore();

Alpine.data('cagnotteWidget', cagnotteWidget);
Alpine.data('tshirtWidget', tshirtWidget);

// Start Alpine
Alpine.start();
