/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Analysts from './pages/Analysts';
import Availability from './pages/Availability';
import Clients from './pages/Clients';
import CreateTicket from './pages/CreateTicket';
import Dashboard from './pages/Dashboard';
import DevPipeline from './pages/DevPipeline';
import Developers from './pages/Developers';
import MyTickets from './pages/MyTickets';
import Notifications from './pages/Notifications';
import ReportedTests from './pages/ReportedTests';
import Settings from './pages/Settings';
import TicketDetail from './pages/TicketDetail';
import TicketReport from './pages/TicketReport';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Analysts": Analysts,
    "Availability": Availability,
    "Clients": Clients,
    "CreateTicket": CreateTicket,
    "Dashboard": Dashboard,
    "DevPipeline": DevPipeline,
    "Developers": Developers,
    "MyTickets": MyTickets,
    "Notifications": Notifications,
    "ReportedTests": ReportedTests,
    "Settings": Settings,
    "TicketDetail": TicketDetail,
    "TicketReport": TicketReport,
}

export const pagesConfig = {
    mainPage: "MyTickets",
    Pages: PAGES,
    Layout: __Layout,
};
