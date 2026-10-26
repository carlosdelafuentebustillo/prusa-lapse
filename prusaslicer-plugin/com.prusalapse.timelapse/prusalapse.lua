-- Prusa-lapse Parked Timelapse Plugin for PrusaSlicer 3.0+
-- Injects parked-head timelapse capture triggers at each layer height BEFORE slicing,
-- enabling full Binary G-code (.bgcode) compatibility, 3D thumbnails, and direct PrusaLink upload.

info = {
    id = "parked_timelapse",
    type = "project.plugin",
    title = "Configure Parked Timelapse",
    menu = "Prusa-lapse/Configure Parked Timelapse",
    params = {
        {
            name = "max_z",
            label = "Max Print Height (mm)",
            type = "float",
            default = 150.0
        },
        {
            name = "park_x",
            label = "Park X Position (mm)",
            type = "float",
            default = 240.0
        },
        {
            name = "park_y",
            label = "Park Y Position (mm)",
            type = "float",
            default = 210.0
        },
        {
            name = "z_hop",
            label = "Z-Hop Lift (mm)",
            type = "float",
            default = 0.4
        },
        {
            name = "retract_dist",
            label = "Retract Distance (mm)",
            type = "float",
            default = 0.8
        },
        {
            name = "settle_ms",
            label = "Vibration Settle Delay (ms)",
            type = "int",
            default = 300
        },
        {
            name = "capture_ms",
            label = "Camera Capture Wait (ms)",
            type = "int",
            default = 1200
        },
        {
            name = "clear_only",
            label = "Clear Timelapse Triggers Only",
            type = "bool",
            default = false
        }
    }
}

local function build_layer_trigger_gcode(opts)
    local park_x = tonumber(opts and opts.park_x) or 240.0
    local park_y = tonumber(opts and opts.park_y) or 210.0
    local z_hop = tonumber(opts and opts.z_hop) or 0.4
    local retract = tonumber(opts and opts.retract_dist) or 0.8
    local settle_ms = math.floor(tonumber(opts and opts.settle_ms) or 300)
    local capture_ms = math.floor(tonumber(opts and opts.capture_ms) or 1200)

    local lines = {
        "; --- PRUSA-LAPSE START ---",
        string.format("G1 E-%.2f F2100 ; Retract filament", retract),
        "G91 ; Relative positioning for Z-hop",
        string.format("G1 Z%.2f F600 ; Z-hop lift", z_hop),
        "G90 ; Return to absolute positioning",
        "M83 ; Relative extrusion",
        string.format("G1 X%.1f Y%.1f F9000 ; Move to park position", park_x, park_y),
        string.format("G4 P%d ; Wait for vibrations to settle", settle_ms),
        "M220 S99 ; Trigger Prusa-lapse capture via PrusaLink speed factor",
        string.format("G4 P%d ; Wait for camera capture", capture_ms),
        "M220 S100 ; Restore 100%% speed factor",
        "G91 ; Relative positioning to restore Z-hop",
        string.format("G1 Z-%.2f F600 ; Undo Z-hop", z_hop),
        "G90 ; Return to absolute positioning",
        "M83 ; Relative extrusion",
        string.format("G1 E%.2f F2100 ; Un-retract filament", retract),
        "; --- PRUSA-LAPSE END ---"
    }
    return table.concat(lines, "\n")
end

function execute(opts)
    local bed = nil
    if api and api.project and api.project.current_bed then
        bed = api.project:current_bed()
    elseif api and api.current_bed then
        bed = api.current_bed()
    end

    if not bed then
        print("Prusa-lapse: No active print bed found.")
        return
    end

    -- Clear existing custom layer steps on this bed first
    if api.project and api.project.clear_layer_custom_steps then
        pcall(function() api.project:clear_layer_custom_steps(bed) end)
    end

    if opts and opts.clear_only then
        print("Prusa-lapse: Cleared custom layer triggers from current bed.")
        return
    end

    -- Read layer_height and first_layer_height from active print preset if available
    local layer_h = 0.20
    local first_layer_h = 0.20

    if bed.print_presets then
        local ok, print_cfg = pcall(function() return bed:print_presets() end)
        if ok and print_cfg and print_cfg.value then
            local ok_lh, lh_val = pcall(function() return tonumber(print_cfg:value("layer_height")) end)
            if ok_lh and lh_val and lh_val >= 0.04 and lh_val <= 1.0 then
                layer_h = lh_val
            end
            local ok_flh, flh_val = pcall(function() return tonumber(print_cfg:value("first_layer_height")) end)
            if ok_flh and flh_val and flh_val >= 0.04 and flh_val <= 1.0 then
                first_layer_h = flh_val
            end
        end
    end

    local max_z = tonumber(opts and opts.max_z) or 150.0
    if max_z < first_layer_h + layer_h then
        max_z = 150.0
    end

    local gcode = build_layer_trigger_gcode(opts)
    local z = first_layer_h + layer_h
    local count = 0

    while z <= max_z + 0.0001 do
        local rounded_z = math.floor(z * 1000 + 0.5) / 1000
        if api.project and api.project.insert_layer_custom_gcode then
            pcall(function()
                api.project:insert_layer_custom_gcode(bed, rounded_z, gcode)
            end)
            count = count + 1
        end
        z = z + layer_h
    end

    print(string.format("Prusa-lapse: Injected %d parked layer triggers (step %.2fmm up to %.1fmm).", count, layer_h, max_z))
end
