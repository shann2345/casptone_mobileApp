# Guide: Force App Restart After Offline Quiz Completion

## Overview
This guide explains how to implement forced app restart after completing a quiz offline to ensure proper data persistence.

## Implementation Steps

### Step 1: Verify AppContext Import

At the top of `attempt-quiz.tsx`, ensure you have this import:

```typescript
import { useApp } from '../../../../context/AppContext';
```

Add it after the NetworkContext import if it's missing.

### Step 2: Add restartApp Hook

Inside the `AttemptQuizScreen` component, verify this line exists (it should already be there based on the attachment):

```typescript
const { restartApp } = useApp();
```

### Step 3: Update handleFinalizeQuiz Function

Find the section in `handleFinalizeQuiz` that handles offline mode. It should look something like:

```typescript
if (isOffline === 'true' || !netInfo?.isInternetReachable) {
  // OFFLINE MODE: Save to local database
  console.log('📴 Offline finalization - saving to local database');

  // Update the submitted assessment in the database to mark it as completed
  await saveSubmittedAssessmentToDb({
    ...submittedAssessment!,
    status: 'completed',
    completed_at: new Date().toISOString(),
  });

  // Mark the assessment in the enrollment as completed
  const user = await getUserData();
  if (user?.email) {
    await markAssessmentCompleted(user.email, Number(assessmentId));
  }

  Alert.alert(
    'Quiz Submitted Offline',
    'Your quiz has been marked as completed locally...',
    [{ text: 'OK', onPress: () => router.replace(...) }]
  );
  return;
}
```

**Replace the entire Alert.alert section with:**

```typescript
// Show alert requiring app restart for offline completion
Alert.alert(
  '✅ Quiz Completed Offline',
  'Your quiz has been saved locally and marked as completed.\n\n⚠️ The app needs to restart to properly save your offline progress.\n\nPress OK to restart the app now.',
  [
    {
      text: 'OK',
      onPress: () => {
        console.log('🔄 Restarting app to save offline quiz...');
        // Use the restartApp function from AppContext to force app restart
        restartApp();
      }
    }
  ],
  { cancelable: false } // Prevent dismissing the alert
);

return; // Don't navigate yet, let the app restart handle it
```

## What This Does

1. **Saves the quiz locally** - Marks it as completed in the local database
2. **Shows an alert** - Informs the user that a restart is required
3. **Forces restart** - When user presses OK, `restartApp()` remounts the entire app
4. **Non-dismissible** - `cancelable: false` prevents user from dismissing without restarting
5. **Proper persistence** - The restart ensures all local database changes are properly persisted

## How restartApp() Works

The `restartApp()` function from `AppContext.tsx`:
- Increments a key state variable
- Causes the entire app tree to remount with `<React.Fragment key={key}>`
- This effectively "restarts" the app without closing and reopening it
- All components reinitialize, ensuring fresh state and proper data loading

## User Experience Flow

1. User completes quiz offline
2. Quiz is saved to local database
3. Alert appears: "Quiz Completed Offline - App needs to restart..."
4. User presses OK
5. App restarts automatically
6. User is taken back to login/home screen
7. Quiz data is properly persisted and will be visible in the to-do list

## Testing

To test this functionality:
1. Enable airplane mode or disable WiFi
2. Start and complete a quiz
3. Press "Finalize Quiz"
4. Verify alert appears with restart message
5. Press OK
6. Verify app restarts to initial screen
7. Navigate back to courses/to-do
8. Verify completed quiz appears in to-do list

## Benefits

- ✅ Ensures proper data persistence in offline mode
- ✅ Prevents data corruption from incomplete writes
- ✅ Clear user communication about what's happening
- ✅ Automatic sync preparation for when connection is restored
- ✅ Consistent app state after offline operations
