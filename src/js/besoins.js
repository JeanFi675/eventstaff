import Alpine from 'alpinejs';
import { initAdminTimelineApp } from './admin-timeline.js';

document.addEventListener('alpine:init', () => {
  initAdminTimelineApp();
});

Alpine.start();
