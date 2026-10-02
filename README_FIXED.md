# Poultry Local Server - Fixed

## Start
1. Open a terminal in this folder.
2. Run:
   npm install
   node server.js
3. Open:
   http://localhost:3000

## Login accounts
- Boss: boss / boss123
- Coop-01 Manager: manager1 / manager123
- Coop-02 Manager: manager2 / manager123
- Coop-03 Manager: manager3 / manager123

## Fixed
- `http://localhost:3000` now opens the login page when no valid session exists.
- Dashboard HTML pages are protected by role.
- A manager cannot open the boss dashboard.
- The boss cannot be sent to a manager dashboard.
- Expired sessions are removed.
- Existing sensor database/data is preserved.
