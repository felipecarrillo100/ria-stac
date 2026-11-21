import {createRoot} from "react-dom/client";
import {CssBaseline, ThemeProvider} from "@mui/material";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import {LocalizationProvider} from "@mui/x-date-pickers/LocalizationProvider";
import {AdapterDayjs} from "@mui/x-date-pickers/AdapterDayjs";
import {theme} from "./theme.js";
import {App} from "./App.js";

// STAC times are UTC instants: the pickers show and edit them in UTC.
dayjs.extend(utc);
dayjs.extend(timezone);

createRoot(document.getElementById("root")!).render(
    <ThemeProvider theme={theme}>
        <CssBaseline/>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
            <App/>
        </LocalizationProvider>
    </ThemeProvider>,
);
