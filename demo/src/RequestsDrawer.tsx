import {Box, Drawer, IconButton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography, Button} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {explorer, useExplorer} from "./state/explorer.js";

/** Every request the library made: method, status, time and URL (credentials are never reported). */
export function RequestsDrawer() {
    const s = useExplorer();
    return (
        <Drawer anchor="bottom" open={s.requestsOpen} onClose={() => explorer.toggleRequests(false)} slotProps={{paper: {sx: {height: "40vh"}}}}>
            <Box sx={{display: "flex", alignItems: "center", px: 2, py: 1, gap: 2}}>
                <Typography variant="subtitle2">Requests ({s.requests.length})</Typography>
                <Typography variant="caption" color="text.secondary">Newest first. URLs without added parameters; headers and credentials are never shown.</Typography>
                <Box sx={{flex: 1}}/>
                <Button onClick={() => explorer.clearRequests()}>Clear</Button>
            </Box>
            <Box sx={{overflow: "auto", flex: 1}}>
                <Table size="small" stickyHeader>
                    <TableHead><TableRow><TableCell>Method</TableCell><TableCell>Status</TableCell><TableCell>ms</TableCell><TableCell>Kind</TableCell><TableCell>URL</TableCell><TableCell/></TableRow></TableHead>
                    <TableBody>{s.requests.map((r, i) => (
                        <TableRow key={i} hover>
                            <TableCell>{r.method}</TableCell>
                            <TableCell sx={{color: /abort/i.test(r.error ?? "") ? "text.secondary" : r.status === undefined || r.status >= 400 ? "error.main" : "success.main"}}>
                                {r.status ?? (/abort/i.test(r.error ?? "") ? "cancelled" : r.error ?? "failed")}</TableCell>
                            <TableCell>{r.ms.toFixed(0)}</TableCell>
                            <TableCell>{r.kind}</TableCell>
                            <TableCell sx={{fontFamily: "JetBrains Mono, monospace", fontSize: 11, wordBreak: "break-all"}}>{decodeURIComponent(r.url)}</TableCell>
                            <TableCell><Tooltip title="Copy as curl"><IconButton size="small" onClick={() => void navigator.clipboard.writeText(`curl '${r.url}'`)}><ContentCopyIcon fontSize="inherit"/></IconButton></Tooltip></TableCell>
                        </TableRow>
                    ))}</TableBody>
                </Table>
            </Box>
        </Drawer>
    );
}
