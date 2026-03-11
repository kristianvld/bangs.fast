import { removeSessionStorageItem } from "./redirect/browser-storage";
import { readHashSearchQuery } from "./search-url";

const SHELL_RECOVERY_KEY = "bangs-shell-recovery-attempts-v1";
const SHELL_RECOVERY_PARAM = "__shell_recover";

const currentUrl = new URL(window.location.href);
const hadRecoveryParam = currentUrl.searchParams.has(SHELL_RECOVERY_PARAM);
if (hadRecoveryParam) {
  currentUrl.searchParams.delete(SHELL_RECOVERY_PARAM);
}

removeSessionStorageItem(SHELL_RECOVERY_KEY);

if (hadRecoveryParam) {
  window.history.replaceState(null, "", currentUrl.toString());
}

const searchQuery = readHashSearchQuery(currentUrl.hash);

if (searchQuery) {
  void import("./search-bootstrap").then(({ handleSearchNavigation }) => handleSearchNavigation(currentUrl, searchQuery));
} else {
  void import("./app-entry");
}
