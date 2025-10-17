# Quick Implementation Guide: Add Sync Notifications to All Screens

## Files to Update

### ✅ 1. to-do.tsx (ALREADY DONE)
Already implemented with visual indicator!

---

### 📝 2. settings.tsx (IN PROGRESS - Needs Import)

**Add this import at the top** (around line 1-5):
```typescript
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
```

**Hook is already added** (line 60-63) ✅:
```typescript
// 🔔 Add pending sync notification hook
const { hasPendingSync, manualCheck } = usePendingSyncNotification(
  isInternetReachable,
  'settings'
);
```

---

### 📝 3. courses/index.tsx (IN PROGRESS - Needs Import)

**Add this import at the top** (around line 1-5):
```typescript
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
```

**Hook is already added** (line 76-79) ✅:
```typescript
// 🔔 Add pending sync notification hook
const { hasPendingSync, manualCheck } = usePendingSyncNotification(
  netInfo?.isInternetReachable ?? null,
  'courses'
);
```

---

### 📝 4. courses/[id].tsx (TODO)

**Step 1: Add import** (around line 1-10):
```typescript
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
```

**Step 2: Add hook** (around line 105, after `const sectionListRef = useRef<SectionList<CourseItem>>(null);`):
```typescript
// 🔔 Add pending sync notification hook
const { hasPendingSync, manualCheck } = usePendingSyncNotification(
  netInfo?.isInternetReachable ?? null,
  'course-details'
);
```

---

### 📝 5. courses/assessments/[assessmentId].tsx (TODO)

**Step 1: Add import** (around line 1-10):
```typescript
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
```

**Step 2: Add hook** (around line 82, after `const navigation = useNavigation();`):
```typescript
// 🔔 Add pending sync notification hook
const { hasPendingSync, manualCheck } = usePendingSyncNotification(
  netInfo?.isInternetReachable ?? null,
  'assessment-details'
);
```

---

## Manual Steps (Copy-Paste Ready)

### For settings.tsx:
1. Scroll to the imports section (top of file)
2. Add this line after `import React, { useEffect, useState } from 'react';`:
```typescript
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
```

### For courses/index.tsx:
1. Scroll to the imports section (top of file)
2. Add this line after the React import:
```typescript
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
```

### For courses/[id].tsx:
1. Add import at top:
```typescript
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
```

2. Find line with `const sectionListRef = useRef<SectionList<CourseItem>>(null);`
3. Add after it:
```typescript
// 🔔 Add pending sync notification hook
const { hasPendingSync, manualCheck } = usePendingSyncNotification(
  netInfo?.isInternetReachable ?? null,
  'course-details'
);
```

### For courses/assessments/[assessmentId].tsx:
1. Add import at top:
```typescript
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';
```

2. Find line with `const navigation = useNavigation();`
3. Add after it:
```typescript
// 🔔 Add pending sync notification hook
const { hasPendingSyncNotification } = usePendingSyncNotification(
  netInfo?.isInternetReachable ?? null,
  'assessment-details'
);
```

---

## What This Does

When internet reconnects on ANY of these screens:
1. 🔍 Hook checks database for pending syncs
2. 🔔 Shows alert: "You have X assessments to sync"
3. 👆 User clicks "Sync Now"
4. 🚀 Navigates to dashboard
5. ✅ Dashboard syncs everything

---

## Testing Checklist

- [ ] settings.tsx - Import added
- [ ] courses/index.tsx - Import added
- [ ] courses/[id].tsx - Import + hook added
- [ ] courses/assessments/[assessmentId].tsx - Import + hook added
- [ ] Test: Go offline → submit work → navigate to each screen → reconnect → alert appears ✅

---

## Quick Copy-Paste Block

**For any screen, add these 2 things:**

```typescript
// 1. At top with imports:
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';

// 2. Inside component, after other hooks:
usePendingSyncNotification(
  netInfo?.isInternetReachable ?? null,
  'screen-name-here'
);
```

Replace `'screen-name-here'` with:
- `'settings'` for settings
- `'courses'` for courses index
- `'course-details'` for course [id]
- `'assessment-details'` for assessment details

---

## Done! 🎉

Once all imports are added, the sync notification system will work across your entire app!
