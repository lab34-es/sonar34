import { Outlet, NavLink, useLocation } from "react-router-dom";
import Box from "@mui/joy/Box";
import Sheet from "@mui/joy/Sheet";
import List from "@mui/joy/List";
import ListItem from "@mui/joy/ListItem";
import ListItemButton from "@mui/joy/ListItemButton";
import ListItemContent from "@mui/joy/ListItemContent";
import Typography from "@mui/joy/Typography";

const NAV_ITEMS = [
  { label: "Repos", path: "/repos" },
  { label: "Search", path: "/search" },
  { label: "Jobs", path: "/admin/jobs" },
  { label: "Settings", path: "/admin/settings" },
];

export default function Layout() {
  const location = useLocation();
  const isFullScreen = location.pathname.startsWith("/commit/");

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      {!isFullScreen && <Sheet
        className="no-print"
        sx={{
          width: 220,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "#ffffff",
        }}
      >
        <Box sx={{ p: 2, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1 }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 400 120"
            width="180"
            height="54"
            aria-label="Sonar34 logo"
          >
            <style>{`
              .s34-sweep{transform-origin:0 0;animation:s34-spin 4s linear infinite}
              .s34-b1{animation:s34-pulse 2.5s infinite;animation-delay:.2s}
              .s34-b2{animation:s34-pulse 2.5s infinite;animation-delay:1.8s}
              .s34-b3{animation:s34-pulse 2.5s infinite;animation-delay:3.1s}
              @keyframes s34-spin{100%{transform:rotate(360deg)}}
              @keyframes s34-pulse{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1.3)}}
            `}</style>
            <defs>
              <linearGradient id="s34-grad" x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#0284C7" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#0284C7" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g transform="translate(60, 60)">
              <circle cx="0" cy="0" r="8" fill="#0284C7" />
              <circle cx="0" cy="0" r="22" fill="none" stroke="#E2E8F0" strokeWidth="2" />
              <circle cx="0" cy="0" r="42" fill="none" stroke="#E2E8F0" strokeWidth="2" strokeDasharray="4 4" />
              <g className="s34-sweep">
                <path d="M0,0 L42,0 A42,42 0 0,0 0,-42 Z" fill="url(#s34-grad)" />
                <line x1="0" y1="0" x2="42" y2="0" stroke="#0284C7" strokeWidth="2" />
              </g>
              <circle cx="18" cy="-18" r="3" fill="#10B981" className="s34-b1" />
              <circle cx="-24" cy="12" r="3.5" fill="#EF4444" className="s34-b2" />
              <circle cx="-10" cy="-28" r="2.5" fill="#F59E0B" className="s34-b3" />
            </g>
            <text x="135" y="72" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" fontSize="52" fontWeight="800" fill="#0F172A" letterSpacing="-1.5">
              Sonar<tspan fill="#0284C7" fontWeight="300">34</tspan>
            </text>
            <text x="140" y="94" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" fontSize="11" fontWeight="600" fill="#64748B" letterSpacing="3.5">
              ENTERPRISE REPO INTELLIGENCE
            </text>
          </svg>
        </Box>

        <List
          size="sm"
          sx={{
            py: 1,
            "--ListItem-radius": "6px",
            "--List-padding": "8px",
            "--List-gap": "4px",
          }}
        >
          {NAV_ITEMS.map((item) => (
            <ListItem key={item.path}>
              <ListItemButton
                component={NavLink}
                to={item.path}
                selected={location.pathname === item.path}
                sx={{
                  "&.active": {
                    bgcolor: "primary.softBg",
                    color: "primary.softColor",
                  },
                }}
              >
                <ListItemContent>
                  <Typography level="body-sm">{item.label}</Typography>
                </ListItemContent>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Sheet>}

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flex: 1,
          p: isFullScreen ? 0 : 3,
          overflow: "auto",
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
