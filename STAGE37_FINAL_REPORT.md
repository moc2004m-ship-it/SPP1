# Stage 37 — Analytics/BI + Legal/Store Compliance

Implemented real analytics over repository data: DAU/MAU, coin-based ARPU proxy (`arpuCoins`), retention cohort calculation, recharge funnel, room activity, and game activity. Added an authenticated analytics admin endpoint and explicit legal/store-compliance content for age rating, UGC policy, and data protection.

No monetary ARPU is invented because recharge orders currently have no verified monetary price field. The API reports that limitation explicitly.
