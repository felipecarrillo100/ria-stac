import {useEffect, useState} from "react";
import {Box, Tooltip} from "@mui/material";
import HideImageOutlinedIcon from "@mui/icons-material/HideImageOutlined";

/**
 * A thumbnail, or a placeholder when there is none or it fails to load (a broken link, a server that refuses the
 * browser, a format it cannot show), so the list never shows a broken image.
 */
export function Thumbnail({src, size = 52}: { src: string | undefined; size?: number }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);
    const why = !src ? "No preview: the item has no thumbnail a browser can show" : failed ? "The preview could not be loaded" : undefined;
    const box = (
        <Box sx={{width: size, height: size, flex: "none", borderRadius: 1, bgcolor: "rgba(148,163,184,0.1)", overflow: "hidden", display: "grid", placeItems: "center"}}>
            {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} style={{width: "100%", height: "100%", objectFit: "cover"}}/>
                : <HideImageOutlinedIcon sx={{color: "text.disabled", fontSize: Math.round(size * 0.4)}}/>}
        </Box>
    );
    return why ? <Tooltip title={why}>{box}</Tooltip> : box;
}
