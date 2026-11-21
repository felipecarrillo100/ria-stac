import {createTheme} from "@mui/material/styles";

/** Dark, dense and calm: one accent (sky) for chosen things, amber for hover, the same on the map and in lists. */
export const palette = {accent: "#38bdf8", hover: "#fbbf24", extent: "rgba(167,139,250,0.85)", area: "#f472b6"};

export const theme = createTheme({
    palette: {
        mode: "dark",
        primary: {main: palette.accent},
        secondary: {main: "#a78bfa"},
        warning: {main: palette.hover},
        background: {default: "#0b0f17", paper: "#111827"},
        divider: "rgba(148,163,184,0.16)",
    },
    shape: {borderRadius: 8},
    typography: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 13,
        h6: {fontSize: 15, fontWeight: 600},
        subtitle2: {fontWeight: 600, fontSize: 13},
        caption: {fontSize: 11.5},
    },
    components: {
        // Thin scrollbars everywhere (Firefox: scrollbar-width; Chromium and Safari: the webkit pseudo-elements).
        MuiCssBaseline: {styleOverrides: {
            "*": {scrollbarWidth: "thin", scrollbarColor: "rgba(148,163,184,0.35) transparent"},
            "*::-webkit-scrollbar": {width: 6, height: 6},
            "*::-webkit-scrollbar-track": {background: "transparent"},
            "*::-webkit-scrollbar-thumb": {background: "rgba(148,163,184,0.35)", borderRadius: 3},
            "*::-webkit-scrollbar-thumb:hover": {background: "rgba(148,163,184,0.6)"},
        }},
        MuiButton: {defaultProps: {size: "small", disableElevation: true}, styleOverrides: {root: {textTransform: "none", fontWeight: 600}}},
        MuiTab: {styleOverrides: {root: {textTransform: "none", minHeight: 44, fontWeight: 600}}},
        MuiTabs: {styleOverrides: {root: {minHeight: 44}}},
        MuiChip: {defaultProps: {size: "small"}},
        MuiTextField: {defaultProps: {size: "small"}},
        MuiToggleButton: {styleOverrides: {root: {textTransform: "none", paddingTop: 3, paddingBottom: 3}}},
        MuiTooltip: {defaultProps: {arrow: true}},
        MuiPaper: {styleOverrides: {root: {backgroundImage: "none"}}},
    },
});

export const mono = "'JetBrains Mono', ui-monospace, monospace";
