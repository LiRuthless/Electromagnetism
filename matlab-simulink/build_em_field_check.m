function build_em_field_check()
%BUILD_EM_FIELD_CHECK 程序化构建磁场/电感开环验证模型 em_field_check.slx。
% 用途：Plant 块单独横向扫过直导线（e 从 -150mm 到 +150mm，0.1 m/s），
% 输出 4 通道 U(e)，由 selfcheck/sc_field.m 对照无限长直导线解析解（式 5.5）。
root = fileparts(mfilename('fullpath'));
mdl = 'em_field_check';
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);

add_block('simulink/User-Defined Functions/Interpreted MATLAB Function', ...
    [mdl '/Plant'], 'MATLABFcn','ifcPlant', 'OutputWidth','4', 'Position',[260 080 330 140]);

% e(t)：Ramp 斜率 0.1 m/s、初值 -0.15 → 3 s 扫完 ±150 mm；y=2.0 m 处，θ=π/2（朝 +y）
addb(mdl,'Ramp_e','simulink/Sources/Ramp', [060 060 110 090], ...
    'slope','0.1','start','0','X0','-0.15');
addc(mdl,'C_y0','2.0',  [060 110 110 135]);
addc(mdl,'C_th0','pi/2',[060 160 110 185]);
addb(mdl,'Mux_in','simulink/Signal Routing/Mux', [170 090 190 150], 'Inputs','3');
addb(mdl,'Mux_log','simulink/Signal Routing/Mux', [400 090 420 150], 'Inputs','2');
addb(mdl,'Log','simulink/Sinks/To Workspace', [460 100 530 135], ...
    'VariableName','elog','SaveFormat','Structure With Time');

L = @(a,b) add_line(mdl,a,b,'autorouting','on');
L('Ramp_e/1','Mux_in/1');
L('C_y0/1','Mux_in/2');
L('C_th0/1','Mux_in/3');
L('Mux_in/1','Plant/1');
L('Ramp_e/1','Mux_log/1');
L('Plant/1','Mux_log/2');
L('Mux_log/1','Log/1');

set_param(mdl, 'SolverType','Fixed-step', 'Solver','FixedStepDiscrete', ...
    'FixedStep','P.dt', 'StopTime','3.0', ...
    'InitFcn','em_ensure_init;');

% 全连线后编译验证（报错直接抛出，不吞）
set_param(mdl,'SimulationCommand','Update');
save_system(mdl, fullfile(root,'em_field_check.slx'));
fprintf('[build] %s.slx 构建并编译通过\n', mdl);
end

% ---------------- 本地辅助 ----------------
function addb(mdl, name, lib, pos, varargin)
add_block(lib, [mdl '/' name], 'Position', pos, varargin{:});
end

function addc(mdl, name, val, pos)
add_block('simulink/Sources/Constant', [mdl '/' name], 'Value', val, 'Position', pos);
end
