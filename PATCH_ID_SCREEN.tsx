// PATCH FILE FOR app/(app)/courses/[id].tsx
// Replace the following functions with these improved versions

// ============================================================
// 1. IMPROVED isAvailable FUNCTION
// Replace the existing isAvailable function (around line 157)
// ============================================================

const isAvailable = (item: Material | Assessment) => {
  // If time manipulation detected, disable all content
  if (timeManipulationDetected) {
    console.log(`🚫 Time manipulation detected, disabling "${item.title}"`);
    return false;
  }

  // Use server time if available, otherwise fall back to device time
  // This allows offline access to content that should be available
  const currentTime = serverTime || new Date();
  
  if (!serverTime) {
    console.log(`⚠️  Server time unavailable for "${item.title}", using device time as fallback`);
  }

  const availableAt = 'available_at' in item ? item.available_at : null;
  const unavailableAt = 'unavailable_at' in item ? item.unavailable_at : null;

  const isAvailable = !availableAt || currentTime >= new Date(availableAt);
  const isNotUnavailable = !unavailableAt || currentTime < new Date(unavailableAt);

  const isItemAvailable = isAvailable && isNotUnavailable;

  console.log(`📅 Checking availability for "${item.title}":`, {
    currentTime: currentTime.toISOString(),
    serverTimeAvailable: !!serverTime,
    isOnline: netInfo?.isInternetReachable || false,
    availableAt: availableAt ? new Date(availableAt).toISOString() : 'N/A',
    unavailableAt: unavailableAt ? new Date(unavailableAt).toISOString() : 'N/A',
    isAvailable: isItemAvailable
  });
  
  return isItemAvailable;
};

// ============================================================
// 2. IMPROVED fetchCourseDetails FUNCTION
// Replace the existing fetchCourseDetails function (around line 197)
// ============================================================

const fetchCourseDetails = async () => {
  setLoading(true);
  let userEmail = '';
  
  try {
    const userData = await getUserData();
    userEmail = userData?.email || '';
    if (!userEmail) {
      console.error('❌ No user data found');
      setCourseDetail(null);
      setLoading(false);
      return;
    }
  } catch (error) {
    console.error('❌ Error getting user data:', error);
    setCourseDetail(null);
    setLoading(false);
    return;
  }

  try {
    // Fetch server time for availability checks - with better offline handling
    const fetchedServerTime = await getServerTime(netInfo?.isInternetReachable ?? false);
    
    if (fetchedServerTime) {
      const parsedTime = new Date(fetchedServerTime);
      setServerTime(parsedTime);
      console.log('✅ Server time loaded for availability checks:', parsedTime.toISOString());
      
      // Only check for time manipulation if we're online with fresh server data
      if (netInfo?.isInternetReachable) {
        const manipulationDetected = await checkTimeManipulation(userEmail);
        setTimeManipulationDetected(manipulationDetected);
        if (manipulationDetected) {
          console.warn('⚠️ Time manipulation detected!');
        } else {
          console.log('✅ No time manipulation detected');
        }
      } else {
        // When offline, don't flag time manipulation - trust the calculated time
        setTimeManipulationDetected(false);
        console.log('📱 Offline mode: Skipping time manipulation check, using calculated time');
      }
    } else {
      // If we can't get server time at all, use device time but don't block content
      console.warn('⚠️ Could not get server time, using device time for basic availability');
      setServerTime(new Date());
      setTimeManipulationDetected(false);
    }

    // Try to get course details from local database first
    let courseData = await getCourseDetails(userEmail, Number(courseId));

    // If online and (no local data OR refreshing), fetch from API
    if (netInfo?.isInternetReachable && (!courseData || isRefreshing)) {
      console.log('🌐 Fetching fresh course details from API...');
      try {
        const response = await api.get(`/courses/${courseId}`);

        if (response.status === 200 && response.data.success) {
          courseData = response.data.course;
          console.log('✅ Course details fetched from API');

          // Save to local database for offline access
          await saveCourseDetails(userEmail, Number(courseId), courseData);
          console.log('💾 Course details saved to local database');
        } else {
          console.error('❌ Failed to fetch course details:', response.data.message);
          // Continue with local data if available
        }
      } catch (apiError) {
        console.error('❌ API error fetching course details:', apiError);
        // Continue with local data if available
      }
    } else if (!netInfo?.isInternetReachable) {
      console.log('📱 Offline mode: Using cached course details');
    }

    if (courseData) {
      console.log('✅ Course details loaded:', courseData.title);
      setCourseDetail(courseData);
    } else {
      console.log('❌ No course details available (online or offline)');
      setCourseDetail(null);
    }
  } catch (error) {
    console.error('❌ Error in fetchCourseDetails:', error);
    setCourseDetail(null);
  } finally {
    setLoading(false);
  }
};

// ============================================================
// INSTRUCTIONS:
// ============================================================
// 1. Open app/(app)/courses/[id].tsx
// 2. Find the isAvailable function (around line 157)
// 3. Replace it with the improved version above
// 4. Find the fetchCourseDetails function (around line 197)
// 5. Replace it with the improved version above
// 6. Save the file
// 7. Test by going offline for 2+ hours after enrolling in a course
