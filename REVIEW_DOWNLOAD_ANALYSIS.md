# Review Data Download Analysis & Fix

## Issue Investigation
Checked if the `handleDownloadReviewData` function in `[assessmentId].tsx` correctly downloads and saves submitted assessment review data, comparing it with the assessment sync pattern.

---

## Original Implementation Analysis

### What the function was doing:
```typescript
1. ✅ Fetch submission ID from `/assessments/{assessmentId}/submitted-assessment`
2. ✅ Use submission ID to fetch full review from `/submitted-assessments/{submissionId}`
3. ✅ Save review data using `saveAssessmentReviewToDb()`
4. ✅ Update local state `setHasLocalReview(true)`
```

### Comparison with Assessment Sync Pattern
The `downloadSingleAssessmentDetails` function (used during assessment sync) does:
```typescript
1. Fetch attempt status from `/assessments/{assessmentId}/attempt-status`
2. Fetch latest submission from `/assessments/{assessmentId}/latest-assignment-submission`  
3. Save BOTH using `saveAssessmentDetailsToDb(assessmentId, userEmail, attemptStatus, latestSubmission)`
```

---

## Problem Identified ❌

**The review download was incomplete!**

While it correctly:
- ✅ Fetched review data
- ✅ Saved it to `offline_assessment_reviews` table

It was **missing**:
- ❌ Fetching current `attemptStatus` (which includes `attempts_made`, `attempts_remaining`, etc.)
- ❌ Updating the `offline_assessment_data` table with latest attempt status

This meant:
- Offline mode wouldn't have the most current attempt count after downloading review
- The assessment details could be stale/inconsistent with the actual submission state

---

## Fix Applied ✅

### Enhanced `handleDownloadReviewData` to match sync pattern:

```typescript
// Step 1: Fetch current attempt status (NEW!)
const attemptResponse = await api.get(`/assessments/${assessmentId}/attempt-status`);
const currentAttemptStatus = attemptResponse.data;

// Step 2: Fetch submission ID (existing)
const subResponse = await api.get(`/assessments/${assessmentId}/submitted-assessment`);
const submissionId = subResponse.data.submitted_assessment.id;

// Step 3: Fetch full review data (existing)
const reviewResponse = await api.get(`/submitted-assessments/${submissionId}`);
const reviewData = reviewResponse.data.submitted_assessment;

// Step 4: Save review data (existing)
await saveAssessmentReviewToDb(assessmentId, userEmail, reviewData);

// Step 5: Update assessment details with latest attempt status (NEW!)
await saveAssessmentDetailsToDb(
  assessmentId,
  userEmail,
  currentAttemptStatus,      // Latest attempt count
  latestAssignmentSubmission // Existing submission data
);
```

---

## What Changed

### Before:
- Only saved review data to `offline_assessment_reviews` table
- Did not update attempt status in `offline_assessment_data` table
- Potential for stale offline data

### After:
- ✅ Saves review data to `offline_assessment_reviews` table
- ✅ Updates attempt status in `offline_assessment_data` table
- ✅ Ensures offline mode has current attempt count
- ✅ Follows the same pattern as assessment sync
- ✅ More robust and consistent data storage

---

## Benefits

1. **Consistency**: Now follows the same data-saving pattern as the assessment sync system
2. **Completeness**: Stores all relevant assessment state, not just review data
3. **Offline Accuracy**: Offline mode will display correct attempt counts after downloading review
4. **Future-proof**: If user goes offline after downloading review, they have complete assessment state

---

## Testing Recommendations

### Scenario 1: Download Review While Online
1. Complete a quiz/exam online
2. Click "Download Review Data"
3. ✅ Verify review downloads successfully
4. ✅ Check attempt count is accurate
5. Go offline
6. ✅ View review offline - should work
7. ✅ Check assessment details show correct attempts made

### Scenario 2: Download Review Then Work Offline
1. Complete assessment online
2. Download review data
3. Disconnect from internet
4. Navigate to assessment details
5. ✅ Attempt status should show correct values
6. ✅ "View Answers" should work offline
7. ✅ Review screen should display correctly

### Scenario 3: Multiple Attempts
1. Take quiz attempt #1 online
2. Download review for attempt #1
3. Take quiz attempt #2 online  
4. Download review for attempt #2
5. ✅ Attempt count should update correctly
6. ✅ Review should show latest submission
7. Go offline
8. ✅ All data should be accessible offline

---

## Database Tables Involved

### `offline_assessment_reviews`
```sql
- assessment_id
- user_email  
- review_data (JSON: full submission with questions, answers, scores)
```

### `offline_assessment_data`
```sql
- assessment_id
- user_email
- data (JSON: { attemptStatus, latestSubmission })
```

**Now both tables are updated when downloading review data!**

---

## Code Location
**File**: `app/(app)/courses/assessments/[assessmentId].tsx`  
**Function**: `handleDownloadReviewData()`  
**Lines**: ~445-498

---

## Status: ✅ FIXED

The review download function now properly:
1. Fetches all necessary data (review + attempt status)
2. Saves to both relevant database tables
3. Matches the assessment sync pattern
4. Provides complete offline functionality
