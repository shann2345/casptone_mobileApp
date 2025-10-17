// EXAMPLE: How to add sync notification to to-do.tsx

// 1️⃣ ADD THIS IMPORT at the top with other imports:
import { usePendingSyncNotification } from '@/hooks/usePendingSyncNotification';

// 2️⃣ ADD THIS HOOK inside your TodoScreen component, right after your existing hooks:
export default function TodoScreen() {
  const router = useRouter();
  const { isConnected, netInfo } = useNetworkStatus();
  const [selectedCategory, setSelectedCategory] = useState<string>('unfinished');
  // ... your other state variables ...

  // ✨ ADD THIS - Pending sync notification
  const { hasPendingSync } = usePendingSyncNotification(
    netInfo?.isInternetReachable ?? null,
    'to-do'
  );

  // ... rest of your component code stays the same ...
}

// 3️⃣ That's it! The hook will automatically:
// - Detect when internet reconnects
// - Check for pending syncs in database  
// - Show alert to user
// - Navigate to dashboard when user clicks "Sync Now"
// - Dashboard's existing sync logic handles the actual syncing

// ========================================
// ALTERNATIVE: If you want manual control
// ========================================

export default function TodoScreen() {
  // ... your existing code ...

  // Use manualCheck if you want to trigger check manually
  const { hasPendingSync, manualCheck, isChecking } = usePendingSyncNotification(
    netInfo?.isInternetReachable ?? null,
    'to-do'
  );

  // Add a manual refresh button in your UI (optional):
  // <TouchableOpacity onPress={manualCheck}>
  //   <Ionicons name="sync" size={24} />
  // </TouchableOpacity>
}
