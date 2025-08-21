/**
 * SpecterSweep - Main Application Component
 * Professional-grade React application for Instagram management
 *
 * @version 2.0.0
 * @author Halfirzzha
 * @license MIT
 */

import React, {
  ChangeEvent,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { render } from "react-dom";
import "./styles.scss";

// Type Imports
import { User, UserNode } from "./model/user";
import { State } from "./model/state";
import { Timings } from "./model/timings";

// Component Imports
import { Toast } from "./components/Toast";
import { UserCheckIcon } from "./components/icons/UserCheckIcon";
import { UserUncheckIcon } from "./components/icons/UserUncheckIcon";
import { NotSearching } from "./components/NotSearching";
import { Searching } from "./components/Searching";
import { Toolbar } from "./components/Toolbar";
import { Unfollowing } from "./components/Unfollowing";

// Utility Imports
import {
  getCookie,
  getCurrentPageUnfollowers,
  getUsersForDisplay,
  sleep,
  unfollowUserUrlGenerator,
  urlGenerator,
} from "./utils/utils";

// Constants
import {
  DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
  DEFAULT_TIME_BETWEEN_UNFOLLOWS,
  DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
  DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS,
  INSTAGRAM_HOSTNAME,
  WHITELISTED_RESULTS_STORAGE_KEY,
} from "./constants/constants";

// =============================================
// GLOBAL STATE MANAGEMENT
// =============================================

let scanningPaused = false;

const pauseScan = (): void => {
  scanningPaused = !scanningPaused;
};

// =============================================
// MAIN APPLICATION COMPONENT
// =============================================

const App: React.FC = () => {
  // =============================================
  // STATE MANAGEMENT
  // =============================================

  const [state, setState] = useState<State>({
    status: "initial",
  });

  const [toast, setToast] = useState<
    { readonly show: false } | { readonly show: true; readonly text: string }
  >({
    show: false,
  });

  const [timings, setTimings] = useState<Timings>({
    timeBetweenSearchCycles: DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
    timeToWaitAfterFiveSearchCycles:
      DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
    timeBetweenUnfollows: DEFAULT_TIME_BETWEEN_UNFOLLOWS,
    timeToWaitAfterFiveUnfollows: DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS,
  });

  // =============================================
  // COMPUTED VALUES
  // =============================================

  const isActiveProcess = useMemo((): boolean => {
    switch (state.status) {
      case "initial":
        return false;
      case "scanning":
      case "unfollowing":
        return state.percentage < 100;
      default:
        // This should never happen, but we need to handle it gracefully
        console.error("Unknown state status:", state);
        return false;
    }
  }, [state]);

  // =============================================
  // EVENT HANDLERS
  // =============================================

  const onScan = useCallback(async (): Promise<void> => {
    if (state.status !== "initial") {
      return;
    }

    try {
      const whitelistedResultsFromStorage = localStorage.getItem(
        WHITELISTED_RESULTS_STORAGE_KEY
      );
      const whitelistedResults: readonly UserNode[] =
        whitelistedResultsFromStorage === null
          ? []
          : JSON.parse(whitelistedResultsFromStorage);

      setState({
        status: "scanning",
        page: 1,
        searchTerm: "",
        currentTab: "non_whitelisted",
        percentage: 0,
        results: [],
        selectedResults: [],
        whitelistedResults,
        filter: {
          showNonFollowers: true,
          showFollowers: false,
          showVerified: true,
          showPrivate: true,
          showWithOutProfilePicture: true,
        },
      });
    } catch (error) {
      console.error("Error initializing scan:", error);
      setToast({
        show: true,
        text: "Failed to initialize scan. Please try again.",
      });
    }
  }, [state.status]);

  const handleScanFilter = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      if (state.status !== "scanning") {
        return;
      }

      if (state.selectedResults.length > 0) {
        if (
          !confirm(
            "Changing filter options will clear selected users. Continue?"
          )
        ) {
          setState({ ...state });
          return;
        }
      }

      setState({
        ...state,
        selectedResults: [],
        filter: {
          ...state.filter,
          [e.currentTarget.name]: e.currentTarget.checked,
        },
      });
    },
    [state]
  );

  const handleUnfollowFilter = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      if (state.status !== "unfollowing") {
        return;
      }

      setState({
        ...state,
        filter: {
          ...state.filter,
          [e.currentTarget.name]: e.currentTarget.checked,
        },
      });
    },
    [state]
  );

  const toggleUser = useCallback(
    (newStatus: boolean, user: UserNode): void => {
      if (state.status !== "scanning") {
        return;
      }

      if (newStatus) {
        setState({
          ...state,
          selectedResults: [...state.selectedResults, user],
        });
      } else {
        setState({
          ...state,
          selectedResults: state.selectedResults.filter(
            (result: UserNode) => result.id !== user.id
          ),
        });
      }
    },
    [state]
  );

  const toggleAllUsers = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      if (state.status !== "scanning") {
        return;
      }

      if (e.currentTarget.checked) {
        setState({
          ...state,
          selectedResults: getUsersForDisplay(
            state.results,
            state.whitelistedResults,
            state.currentTab,
            state.searchTerm,
            state.filter
          ),
        });
      } else {
        setState({
          ...state,
          selectedResults: [],
        });
      }
    },
    [state]
  );

  const toggleCurrentPageUsers = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      if (state.status !== "scanning") {
        return;
      }

      if (e.currentTarget.checked) {
        setState({
          ...state,
          selectedResults: getCurrentPageUnfollowers(
            getUsersForDisplay(
              state.results,
              state.whitelistedResults,
              state.currentTab,
              state.searchTerm,
              state.filter
            ),
            state.page
          ),
        });
      } else {
        setState({
          ...state,
          selectedResults: [],
        });
      }
    },
    [state]
  );

  // =============================================
  // EFFECTS
  // =============================================

  // Prevent accidental page closure during active processes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): string | undefined => {
      if (!isActiveProcess) {
        return;
      }

      e = e || window.event;
      if (e) {
        e.returnValue = "Changes you made may not be saved.";
      }

      return "Changes you made may not be saved.";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isActiveProcess]);

  // Scanning effect
  useEffect(() => {
    const scan = async (): Promise<void> => {
      if (state.status !== "scanning") {
        return;
      }

      const results = [...state.results];
      let scrollCycle = 0;
      let url = urlGenerator();
      let hasNext = true;
      let currentFollowedUsersCount = 0;
      let totalFollowedUsersCount = -1;

      try {
        while (hasNext) {
          let receivedData: User;

          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            receivedData = data.data.user.edge_follow;
          } catch (error) {
            console.error("Fetch error:", error);
            setToast({
              show: true,
              text: "Network error occurred. Retrying...",
            });
            await sleep(5000);
            continue;
          }

          if (totalFollowedUsersCount === -1) {
            totalFollowedUsersCount = receivedData.count;
          }

          hasNext = receivedData.page_info.has_next_page;
          url = urlGenerator(receivedData.page_info.end_cursor);
          currentFollowedUsersCount += receivedData.edges.length;
          receivedData.edges.forEach((x) => results.push(x.node));

          setState((prevState: State) => {
            if (prevState.status !== "scanning") {
              return prevState;
            }

            const percentage = Math.floor(
              (currentFollowedUsersCount / totalFollowedUsersCount) * 100
            );
            return {
              ...prevState,
              percentage,
              results,
            };
          });

          // Handle pause functionality
          while (scanningPaused) {
            await sleep(1000);
            console.info("Scan paused by user");
          }

          // Random delay to prevent rate limiting
          const delay =
            Math.floor(
              Math.random() *
                (timings.timeBetweenSearchCycles -
                  timings.timeBetweenSearchCycles * 0.7)
            ) + timings.timeBetweenSearchCycles;

          await sleep(delay);
          scrollCycle++;

          // Extended pause after multiple cycles to prevent temporary blocking
          if (scrollCycle > 6) {
            scrollCycle = 0;
            const sleepTime = timings.timeToWaitAfterFiveSearchCycles / 1000;
            setToast({
              show: true,
              text: `Sleeping ${sleepTime} seconds to prevent getting temporarily blocked`,
            });

            await sleep(timings.timeToWaitAfterFiveSearchCycles);
            setToast({ show: false });
          }
        }

        setToast({ show: true, text: "Scanning completed successfully!" });
      } catch (error) {
        console.error("Scanning error:", error);
        setToast({ show: true, text: "Scanning failed. Please try again." });
      }
    };

    void scan();
  }, [state.status, timings]);

  // Unfollowing effect
  useEffect(() => {
    const unfollow = async (): Promise<void> => {
      if (state.status !== "unfollowing") {
        return;
      }

      const csrftoken = getCookie("csrftoken");
      if (csrftoken === null) {
        setToast({
          show: true,
          text: "CSRF token not found. Please refresh the page.",
        });
        return;
      }

      let counter = 0;

      try {
        for (const user of state.selectedResults) {
          counter += 1;
          const percentage = Math.floor(
            (counter / state.selectedResults.length) * 100
          );

          try {
            const response = await fetch(unfollowUserUrlGenerator(user.id), {
              headers: {
                "content-type": "application/x-www-form-urlencoded",
                "x-csrftoken": csrftoken,
              },
              method: "POST",
              mode: "cors",
              credentials: "include",
            });

            const success = response.ok;

            setState((prevState: State) => {
              if (prevState.status !== "unfollowing") {
                return prevState;
              }

              return {
                ...prevState,
                percentage,
                unfollowLog: [
                  ...prevState.unfollowLog,
                  {
                    user,
                    unfollowedSuccessfully: success,
                  },
                ],
              };
            });

            if (!success) {
              console.warn(`Failed to unfollow user ${user.username}`);
            }
          } catch (error) {
            console.error(`Error unfollowing user ${user.username}:`, error);

            setState((prevState: State) => {
              if (prevState.status !== "unfollowing") {
                return prevState;
              }

              return {
                ...prevState,
                percentage,
                unfollowLog: [
                  ...prevState.unfollowLog,
                  {
                    user,
                    unfollowedSuccessfully: false,
                  },
                ],
              };
            });
          }

          // Skip delay for last user
          if (
            user === state.selectedResults[state.selectedResults.length - 1]
          ) {
            break;
          }

          // Random delay between unfollows
          const delay =
            Math.floor(
              Math.random() *
                (timings.timeBetweenUnfollows * 1.2 -
                  timings.timeBetweenUnfollows)
            ) + timings.timeBetweenUnfollows;

          await sleep(delay);

          // Extended pause after every 5 unfollows
          if (counter % 5 === 0) {
            const sleepTime = timings.timeToWaitAfterFiveUnfollows / 60000;
            setToast({
              show: true,
              text: `Sleeping ${sleepTime} minutes to prevent getting temporarily blocked`,
            });

            await sleep(timings.timeToWaitAfterFiveUnfollows);
            setToast({ show: false });
          }
        }

        setToast({ show: true, text: "Unfollowing process completed!" });
      } catch (error) {
        console.error("Unfollowing error:", error);
        setToast({
          show: true,
          text: "Unfollowing process failed. Please try again.",
        });
      }
    };

    void unfollow();
  }, [
    state.status,
    state.status !== "initial" ? state.selectedResults : [],
    timings,
  ]);

  // =============================================
  // RENDER LOGIC
  // =============================================

  const renderMainContent = (): React.JSX.Element | null => {
    switch (state.status) {
      case "initial":
        return <NotSearching onScan={onScan} />;

      case "scanning":
        return (
          <Searching
            state={state}
            handleScanFilter={handleScanFilter}
            toggleUser={toggleUser}
            pauseScan={pauseScan}
            setState={setState}
            scanningPaused={scanningPaused}
            UserCheckIcon={UserCheckIcon}
            UserUncheckIcon={UserUncheckIcon}
          />
        );

      case "unfollowing":
        return (
          <Unfollowing
            state={state}
            handleUnfollowFilter={handleUnfollowFilter}
          />
        );

      default:
        // This should never happen, but we need to handle it gracefully
        console.error("Unknown state status:", state);
        return null;
    }
  };

  return (
    <main id="main" role="main" className="iu fade-in">
      <section className="overlay">
        <Toolbar
          state={state}
          setState={setState}
          scanningPaused={scanningPaused}
          isActiveProcess={isActiveProcess}
          toggleAllUsers={toggleAllUsers}
          toggleCurrentePageUsers={toggleCurrentPageUsers}
          setTimings={setTimings}
          currentTimings={timings}
        />

        {renderMainContent()}

        {toast.show && (
          <Toast
            show={toast.show}
            message={toast.text}
            onClose={() => setToast({ show: false })}
          />
        )}
      </section>
    </main>
  );
};

// =============================================
// APPLICATION INITIALIZATION
// =============================================

const initializeApp = (): void => {
  if (location.hostname !== INSTAGRAM_HOSTNAME) {
    alert(
      "This tool can only be used on Instagram. Please navigate to instagram.com and try again."
    );
    return;
  }

  try {
    document.title = "SpecterSweep - Professional Instagram Management";
    document.body.innerHTML = "";
    render(<App />, document.body);
  } catch (error) {
    console.error("Failed to initialize application:", error);
    alert(
      "Failed to load the application. Please refresh the page and try again."
    );
  }
};

// Initialize the application
initializeApp();
