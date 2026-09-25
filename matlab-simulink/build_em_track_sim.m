function build_em_track_sim()
%BUILD_EM_TRACK_SIM 程序化构建闭环循迹仿真模型 em_track_sim.slx。
%
% 闭环信号流（数学模型.md §8.1）：
%   位姿(x,y,θ) → Plant(式5.1/5.2/6.1/6.7/6.8) → U → 误差(式8.1) → PD(式8.2)
%   → 轮速分配(式8.3–8.5) → 电机一阶滞后(式8.7) → 差速运动学(式8.8/8.9)
%   → 新位姿（Unit Delay 反馈）… 直至完赛/失控判停（式 8.10，Stop Simulation）。
%
% 四个算法块用 Interpreted MATLAB Function（块脚本 = blocks/ifc*.m，
% 运行时读 base 工作区的 P/TD——改参数只改 init，无需重建模型）。
% 位姿/轮速/弧长等状态量全部是带初值的 Unit Delay，图上可见。
% 两处除法（/dt、/W）用 Product 真除法而非 1/x 增益，保持与参考实现
% em_simulateTracking 逐 bit 兼容（倒数乘与除法在 IEEE 下差 1 ulp，
% 在 S 弯弯心振荡段会被放大，见 selfcheck/dbg_diff.m）。
root = fileparts(mfilename('fullpath'));
mdl = 'em_track_sim';
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);

% ---------- 算法块（解释型 MATLAB Fcn） ----------
addifc(mdl,'Plant','ifcPlant',4,[200 060 260 120]);
addifc(mdl,'ErrF', 'ifcErr',  1,[330 060 390 100]);
addifc(mdl,'Alloc','ifcAlloc',2,[470 060 530 100]);
addifc(mdl,'LagL', 'ifcLag',  1,[620 030 680 070]);
addifc(mdl,'LagR', 'ifcLag',  1,[620 120 680 160]);

% ---------- 信号路由 ----------
addb(mdl,'Mux_pose','simulink/Signal Routing/Mux',  [140 070 160 130], 'Inputs','3');
addb(mdl,'Mux_err', 'simulink/Signal Routing/Mux',  [290 060 310 120], 'Inputs','5');
addb(mdl,'Demux_v', 'simulink/Signal Routing/Demux',[560 060 580 120], 'Outputs','2');
addb(mdl,'Mux_lagL','simulink/Signal Routing/Mux',  [590 030 605 075], 'Inputs','2');
addb(mdl,'Mux_lagR','simulink/Signal Routing/Mux',  [590 120 605 165], 'Inputs','2');
addb(mdl,'Mux_log', 'simulink/Signal Routing/Mux',  [900 190 920 270], 'Inputs','7');
addb(mdl,'Log','simulink/Sinks/To Workspace', [960 210 1030 245], ...
    'VariableName','simlog','SaveFormat','Structure With Time');

% ---------- 常量 ----------
addc(mdl,'C_finish','TD.finishDist',      [720 240 780 260]);
addc(mdl,'C_errlim','P.errLimit',         [350 240 400 260]);
addc(mdl,'C_errsteps','P.errLimitSteps',  [490 240 540 260]);
addc(mdl,'C_zero','0',[310 300 340 315]);
addc(mdl,'C_one','1', [450 300 480 315]);
addc(mdl,'C_dt','P.dt',[350 340 380 355]);
addc(mdl,'C_W','P.W', [700 250 730 265]);
addb(mdl,'Clk','simulink/Sources/Clock',  [340 200 370 215]);

% ---------- Unit Delay 状态量 ----------
addud(mdl,'UD_x', 'TD.x0',    [060 030 090 060]);
addud(mdl,'UD_y', 'TD.y0',    [060 080 090 110]);
addud(mdl,'UD_th','TD.theta0',[060 130 090 160]);
addud(mdl,'UD_err','0',       [200 160 230 190]);
addud(mdl,'UD_vL','P.vBase',  [720 030 750 060]);
addud(mdl,'UD_vR','P.vBase',  [720 120 750 150]);
addud(mdl,'UD_dist','0',      [790 150 820 180]);
addud(mdl,'UD_run','0',       [390 300 420 330]);

% ---------- PD 链（式 8.2；首步 errRate=0） ----------
addb(mdl,'Sum_derr','simulink/Math Operations/Sum',  [340 160 360 185], 'Inputs','+-');
addb(mdl,'Div_dt', 'simulink/Math Operations/Product', [390 160 430 185], 'Inputs','*/');
addb(mdl,'CmpT0','simulink/Logic and Bit Operations/Compare To Constant', ...
    [400 195 440 220], 'relop','==', 'const','0');
addb(mdl,'Sw_first','simulink/Signal Routing/Switch',[450 160 480 205], ...
    'Criteria','u2 >= Threshold','Threshold','0.5');
addb(mdl,'G_kp','simulink/Math Operations/Gain', [340 110 370 135], 'Gain','P.kp');
addb(mdl,'G_kd','simulink/Math Operations/Gain', [490 160 520 185], 'Gain','P.kd');
addb(mdl,'Sum_u','simulink/Math Operations/Sum',[400 110 420 140], 'Inputs','++');

% ---------- 差速运动学（式 8.8/8.9，半隐式欧拉：先转后移） ----------
addb(mdl,'Sum_v','simulink/Math Operations/Sum',  [760 190 780 215], 'Inputs','++');
addb(mdl,'G_half','simulink/Math Operations/Gain',[800 190 830 215], 'Gain','0.5');
addb(mdl,'Sum_d','simulink/Math Operations/Sum',  [700 220 720 245], 'Inputs','+-');
addb(mdl,'Div_W','simulink/Math Operations/Product',[740 220 770 245], 'Inputs','*/');
addb(mdl,'G_dtW','simulink/Math Operations/Gain', [660 080 690 105], 'Gain','P.dt');
addb(mdl,'Sum_th','simulink/Math Operations/Sum', [730 060 750 090], 'Inputs','++');
addb(mdl,'Cos','simulink/Math Operations/Trigonometric Function', [770 095 795 120], 'Operator','cos');
addb(mdl,'Sin','simulink/Math Operations/Trigonometric Function', [770 125 795 150], 'Operator','sin');
addb(mdl,'Prod_x','simulink/Math Operations/Product', [810 090 835 115]);
addb(mdl,'Prod_y','simulink/Math Operations/Product', [810 125 835 150]);
addb(mdl,'G_dtX','simulink/Math Operations/Gain', [845 090 875 115], 'Gain','P.dt');
addb(mdl,'G_dtY','simulink/Math Operations/Gain', [845 125 875 150], 'Gain','P.dt');
addb(mdl,'Sum_x','simulink/Math Operations/Sum', [890 030 910 060], 'Inputs','++');
addb(mdl,'Sum_y','simulink/Math Operations/Sum', [890 080 910 110], 'Inputs','++');
addb(mdl,'G_dtD','simulink/Math Operations/Gain', [800 250 830 275], 'Gain','P.dt');
addb(mdl,'Sum_dist','simulink/Math Operations/Sum', [850 150 870 180], 'Inputs','++');

% ---------- 终止判定（式 8.10 + 失控判停） ----------
addb(mdl,'AbsE','simulink/Math Operations/Abs', [300 240 325 265]);
addb(mdl,'RelOver','simulink/Logic and Bit Operations/Relational Operator', ...
    [410 240 440 265], 'Operator','>');
addb(mdl,'Sum_run','simulink/Math Operations/Sum', [450 300 470 330], 'Inputs','++');
addb(mdl,'Sw_run','simulink/Signal Routing/Switch', [510 290 540 330], ...
    'Criteria','u2 >= Threshold','Threshold','0.5');
addb(mdl,'RelLost','simulink/Logic and Bit Operations/Relational Operator', ...
    [570 290 600 315], 'Operator','>=');
addb(mdl,'RelFin','simulink/Logic and Bit Operations/Relational Operator', ...
    [800 240 830 265], 'Operator','>=');
addb(mdl,'Or_stop','simulink/Logic and Bit Operations/Logical Operator', ...
    [850 300 880 325], 'Operator','OR','Inputs','2');
addb(mdl,'Stop','simulink/Sinks/Stop Simulation', [920 300 960 325]);

% ---------- 连线 ----------
L = @(a,b) add_line(mdl,a,b,'autorouting','on');
% 位姿状态 → Plant
L('UD_x/1','Mux_pose/1');
L('UD_y/1','Mux_pose/2');
L('UD_th/1','Mux_pose/3');
L('Mux_pose/1','Plant/1');
% 误差（式 8.1，errPrev 回退）
L('Plant/1','Mux_err/1');
L('UD_err/1','Mux_err/2');
L('Mux_err/1','ErrF/1');
% PD（式 8.2；/dt 用真除法，与参考实现逐 bit 一致）
L('ErrF/1','Sum_derr/1');
L('UD_err/1','Sum_derr/2');
L('Sum_derr/1','Div_dt/1');
L('C_dt/1','Div_dt/2');
L('Div_dt/1','Sw_first/3');
L('C_zero/1','Sw_first/1');
L('Clk/1','CmpT0/1');
L('CmpT0/1','Sw_first/2');
L('ErrF/1','G_kp/1');
L('Sw_first/1','G_kd/1');
L('G_kp/1','Sum_u/1');
L('G_kd/1','Sum_u/2');
% 轮速分配 + 电机滞后（式 8.3–8.5 / 8.7）
L('Sum_u/1','Alloc/1');
L('Alloc/1','Demux_v/1');
L('Demux_v/1','Mux_lagL/1');
L('UD_vL/1','Mux_lagL/2');
L('Mux_lagL/1','LagL/1');
L('Demux_v/2','Mux_lagR/1');
L('UD_vR/1','Mux_lagR/2');
L('Mux_lagR/1','LagR/1');
L('LagL/1','UD_vL/1');            % 左轮滞后状态回写
L('LagR/1','UD_vR/1');            % 右轮滞后状态回写
% 运动学（式 8.8/8.9；/W 用真除法）
L('LagL/1','Sum_v/1');
L('LagR/1','Sum_v/2');
L('Sum_v/1','G_half/1');
L('LagR/1','Sum_d/1');
L('LagL/1','Sum_d/2');
L('Sum_d/1','Div_W/1');
L('C_W/1','Div_W/2');
L('Div_W/1','G_dtW/1');
L('UD_th/1','Sum_th/1');
L('G_dtW/1','Sum_th/2');
L('Sum_th/1','UD_th/1');          % θ(n+1) 回写
L('Sum_th/1','Cos/1');
L('Sum_th/1','Sin/1');
L('G_half/1','Prod_x/1');
L('Cos/1','Prod_x/2');
L('G_half/1','Prod_y/1');
L('Sin/1','Prod_y/2');
L('Prod_x/1','G_dtX/1');
L('Prod_y/1','G_dtY/1');
L('UD_x/1','Sum_x/1');
L('G_dtX/1','Sum_x/2');
L('Sum_x/1','UD_x/1');            % x(n+1) 回写
L('UD_y/1','Sum_y/1');
L('G_dtY/1','Sum_y/2');
L('Sum_y/1','UD_y/1');            % y(n+1) 回写
L('G_half/1','G_dtD/1');
L('UD_dist/1','Sum_dist/1');
L('G_dtD/1','Sum_dist/2');
L('Sum_dist/1','UD_dist/1');      % 行驶弧长回写
% err 状态回写
L('ErrF/1','UD_err/1');
% 终止判定
L('ErrF/1','AbsE/1');
L('AbsE/1','RelOver/1');
L('C_errlim/1','RelOver/2');
L('UD_run/1','Sum_run/1');
L('C_one/1','Sum_run/2');
L('Sum_run/1','Sw_run/1');
L('RelOver/1','Sw_run/2');
L('C_zero/1','Sw_run/3');
L('Sw_run/1','UD_run/1');
L('Sw_run/1','RelLost/1');
L('C_errsteps/1','RelLost/2');
L('UD_dist/1','RelFin/1');
L('C_finish/1','RelFin/2');
L('RelLost/1','Or_stop/1');
L('RelFin/1','Or_stop/2');
L('Or_stop/1','Stop/1');
% 日志（x,y,θ,vL,vR,err,U）
L('UD_x/1','Mux_log/1');
L('UD_y/1','Mux_log/2');
L('UD_th/1','Mux_log/3');
L('LagL/1','Mux_log/4');
L('LagR/1','Mux_log/5');
L('ErrF/1','Mux_log/6');
L('Plant/1','Mux_log/7');
L('Mux_log/1','Log/1');

% ---------- 求解器与回调 ----------
set_param(mdl, 'SolverType','Fixed-step', 'Solver','FixedStepDiscrete', ...
    'FixedStep','P.dt', 'StopTime','P.stopTime', ...
    'InitFcn','em_ensure_init;');

% 全连线后编译验证（报错直接抛出，不吞）
set_param(mdl,'SimulationCommand','Update');
save_system(mdl, fullfile(root,'em_track_sim.slx'));
fprintf('[build] %s.slx 构建并编译通过\n', mdl);
end

% ---------------- 本地辅助 ----------------
function addb(mdl, name, lib, pos, varargin)
add_block(lib, [mdl '/' name], 'Position', pos, varargin{:});
end

function addc(mdl, name, val, pos)
add_block('simulink/Sources/Constant', [mdl '/' name], 'Value', val, 'Position', pos);
end

function addud(mdl, name, ic, pos)
add_block('simulink/Discrete/Unit Delay', [mdl '/' name], 'InitialCondition', ic, 'Position', pos);
end

function addifc(mdl, name, fcn, width, pos)
add_block('simulink/User-Defined Functions/Interpreted MATLAB Function', ...
    [mdl '/' name], 'MATLABFcn', fcn, 'OutputWidth', num2str(width), 'Position', pos);
end
