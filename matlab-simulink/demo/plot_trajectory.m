function figFile = plot_trajectory(trackName, initEMm, initPsiDeg)
%PLOT_TRAJECTORY 循迹闭环仿真 + 轨迹/误差/轮速/电感四联图。
% 用 Simulink 模型 em_track_sim.slx 跑（未构建则先 build_em_track_sim）。
% 用法：plot_trajectory('track_s_curve', 30, 5)
% 输出：outputs/tracking_<赛道名>.png
if nargin < 1, trackName = 'track_s_curve'; end
if nargin < 2, initEMm = 30; end
if nargin < 3, initPsiDeg = 5; end
ensureRoot();
P = params();
P.initE = initEMm/1000;
P.initPsi = initPsiDeg*pi/180;
P.Pcoef = -1;   % 负反馈：本布局 (L-R)/(L+R) 与纠偏方向相反（见 sc_tracking 头注）
init(trackName, P);
TD = evalin('base','TD');

root = fileparts(fileparts(mfilename('fullpath')));
if ~exist(fullfile(root,'em_track_sim.slx'),'file')
    build_em_track_sim();
end
simOut = sim('em_track_sim');
v = simOut.simlog.signals.values;    % [x y th vL vR err U1..U4]
t = simOut.simlog.time;

fig = figure('Visible','off','Position',[80 60 1100 760]);
subplot(2,2,1);
plot(TD.path.pts(:,1), TD.path.pts(:,2), 'k--', 'LineWidth', 1.2); hold on;
plot(v(:,1), v(:,2), 'b-', 'LineWidth', 1.2);
plot(v(1,1), v(1,2), 'go', 'MarkerFaceColor','g');
plot(v(end,1), v(end,2), 'rs', 'MarkerFaceColor','r');
axis equal tight; grid on; xlabel('x (m)'); ylabel('y (m)');
legend('赛道中线','仿真轨迹','起点','终点','Location','best');
title(sprintf('循迹轨迹（%s，e_0=%dmm，\\psi_0=%d°）', strrep(TD.name,'_','\_'), round(initEMm), round(initPsiDeg)));

subplot(2,2,2);
plot(t, v(:,6), 'LineWidth', 1.2); grid on;
xlabel('t (s)'); ylabel('Err'); title('循迹误差（式 8.1）');

subplot(2,2,3);
plot(t, v(:,4), '-', t, v(:,5), '-', 'LineWidth', 1.2); grid on;
xlabel('t (s)'); ylabel('轮速 (m/s)'); legend('v_L','v_R','Location','best');
title('实际轮速（电机滞后后，式 8.7）');

subplot(2,2,4);
plot(t, v(:,7), t, v(:,8), t, v(:,9), t, v(:,10), 'LineWidth', 1.1); grid on;
xlabel('t (s)'); ylabel('U (Vpp)'); legend('L1','R1','L2','R2','Location','best');
title('各电感读数（式 6.1）');

figFile = fullfile(ensureOutDir(), sprintf('tracking_%s.png', TD.name));
print(fig, '-dpng', '-r150', figFile);
close(fig);
fprintf('[demo] 循迹仿真图已保存：%s（%d 步，%.2f s）\n', figFile, numel(t), t(end));
end

function ensureRoot()
here = fileparts(mfilename('fullpath'));
root = fileparts(here);
if isempty(which('params'))
    addpath(root, fullfile(root,'track_lib'), fullfile(root,'geom'), ...
        fullfile(root,'field'), fullfile(root,'sensor'), fullfile(root,'control'), ...
        fullfile(root,'blocks'), fullfile(root,'selfcheck'), fullfile(root,'demo'));
end
end

function d = ensureOutDir()
here = fileparts(mfilename('fullpath'));
d = fullfile(fileparts(here), 'outputs');
if ~exist(d,'dir'), mkdir(d); end
end
