// Re-export client
export { supabase } from './supabase/client';

// Re-export all services
export { boardsService, boardStagesService } from './supabase/boards';
export { contactsService, companiesService } from './supabase/contacts';
export { dealsService } from './supabase/deals';
export { activitiesService } from './supabase/activities';
export { productsService } from './supabase/products';
export { settingsService, lifecycleStagesService } from './supabase/settings';
export { tagsService, contactTagsService } from './supabase/tags';
export { customFieldDefinitionsService } from './supabase/customFields';
export { goalsService, toMonthKey, monthRange } from './supabase/goals';

// Re-export Realtime hooks
export { useRealtimeSync, useRealtimeSyncAll, useRealtimeSyncKanban } from './realtime';
